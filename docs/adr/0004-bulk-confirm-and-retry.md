# ADR-0004 — Bulk runner: confirmed outcomes, retry with backoff, and pacing

- Status: Accepted
- Date: 2026-07-31

## Context

The Reply Rail's bulk Block/Mute (`entrypoints/content/actions.ts`) fired its direct
API calls (`POST /1.1/blocks/create.json`, `/1.1/mutes/users/create.json`) in a fixed
250ms-paced burst and treated any HTTP 2xx as success: recorded to the local ledger
immediately, counted in the summary, done. In practice a transient error or a rate
limit could leave an account not actually blocked, and nothing retried it or told the
user which accounts were still unprotected (issue #42).

## Options considered

### A. Trust the 2xx forever (status quo) — REJECTED

The problem statement exists precisely because this silently drops failures; not a
real option once the issue was filed.

### B. Confirm via a second internal v1.1 endpoint (`friendships/show.json`) — CHOSEN

Reuse the same session-authenticated request plumbing (bearer + `ct0`, ADR-0001) for a
`GET` that reports the authenticated user's own relationship to the target, including
`blocking`/`muting`. Same vintage and auth pattern as the already-shipped create
endpoints, so the confirm step is one more call on rails the code already trusts,
rather than a new integration.

### C. Confirm via the GraphQL relationship/timeline surface — REJECTED (for now)

The live web client has largely moved profile/timeline reads to GraphQL query IDs that
rotate and require a matching persisted-query hash per endpoint — more fragile to hardcode
than a stable v1.1 path, and a bigger lift to reverse-engineer than this change's scope
justified. Revisit if `friendships/show.json` turns out to be deprecated in practice.

### D. Trust a longer client-side delay instead of confirming — REJECTED

Waiting N seconds and re-trusting the 2xx doesn't distinguish "still processing" from
"actually failed"; it's a slower version of the status quo's blind trust, not a fix.

## Decision (B)

The bulk runner (`createReplyBatchRunner`, still the same public surface: an
`isRunning` flag and a `run(type, onProgress)` that returns a `BatchSummary`) gains a
per-account lifecycle: **act → confirm → retry with backoff → record**.

### Confirmation endpoint

`GET /1.1/friendships/show.json?target_screen_name=<user>`. Its
`relationship.source.blocking` / `relationship.source.muting` report the authenticated
user's own relationship to the target — exactly the ground truth needed. Implemented in
`x-api.ts` (`createRelationshipLookupRequest`, `parseRelationshipResponse`,
`confirmDirectAction`). An HTTP 2xx on the create call is no longer sufficient on its
own; only a confirmed `blocking`/`muting: true` counts.

### Retry, backoff, and pacing

- A bounded budget of `MAX_ACCOUNT_ATTEMPTS = 3` act→confirm attempts per account.
- Exponential backoff between attempts: `base * 2^(attempt-1) + jitter`. An ordinary
  failure uses `RETRY_BASE_DELAY_MS = 500` / `RETRY_JITTER_MS = 250`; a rate-limit-shaped
  failure (HTTP 429, from either the action or the confirmation call) uses
  `RATE_LIMIT_BASE_DELAY_MS = 4000` / `RATE_LIMIT_JITTER_MS = 2000` instead — "waits
  meaningfully longer than an ordinary failure" — and that classification sticks for
  the rest of the account's attempts once seen.
- The act call is re-issued on every attempt (the create endpoints are idempotent
  against an already-blocked/muted target); confirmation is the sole source of truth,
  so an attempt whose act call fails still confirms immediately if the lookup already
  shows the account blocked/muted (e.g. a prior run on the same thread already did it)
  — a re-run never pays for retries it doesn't need.
- Inter-account pacing stays the pre-existing fixed `SCHEDULE_BASE_DELAY_MS = 250`.
  `onProgress` still fires exactly once per account, after that account's full
  lifecycle (including retries) settles.
- No new attempt budget or pacing settings; these are constants owned by the runner,
  same as before.

### Summary and ledger

`BatchSummary` is now `{ confirmed, skipped, unconfirmed }` (previously
`{ acted, skipped, failed }`): `confirmed` counts only accounts the relationship lookup
actually asserted; `unconfirmed` covers both a missing username and an account whose
confirmation never came back true within its attempt budget. Unconfirmed handles are
named in a `console.warn` at the end of the run; the rail's toast keeps showing counts
only. The local ledger (`blockedStore`) is written only on confirmation — a change from
the previous record-on-2xx behavior — so the popup gauge and the cloud backup reflect
what X actually asserts, not what the create call merely accepted.

### Out of scope (unchanged from the original spec)

The Cursor Console's single-reply path (`blockTweet`/`muteTweet`) and the auto-confirm
quick-block flow keep their existing record-on-2xx behavior — confirm/retry is bulk-only.
No persistent cross-page queue; the schedule still lives in-page and in-memory.

## Deviations from the spec

Called out explicitly rather than left for a reader to notice by diffing:

- **Pacing jitter.** The spec's Implementation Decisions say "the current fixed
  inter-action delay becomes the schedule's base delay plus jitter." Only the RETRY
  backoff above got jitter; the 250ms inter-account pacing stayed exactly fixed, with no
  jitter added. Reason: `test/content/rail-actions.test.ts`'s on-button progress
  assertions pin exact 250ms ticks (`manual.flushUpTo(250)` to advance from "1 / 3" to
  "2 / 3"), and jitter has no other legacy behavior to preserve — the retry backoff is
  a wholly new mechanism, so that's where the spec's jitter requirement is realized
  instead. If a future change needs pacing jitter too, `rail-actions.test.ts`'s
  hardcoded flush points need updating alongside it.
- **Live endpoint validation.** The spec says to "validate the exact endpoint against
  the live web client during implementation, the same way the block endpoints were
  validated." That validation was not done for this change — this repo's tooling has no
  live, authenticated x.com session to validate against. The endpoint choice (Option B
  above) follows the same request shape and precedent as the already-shipped create
  endpoints, and the runner's confirm/retry contract is decoupled from the endpoint's
  specifics (only `x-api.ts`'s lookup layer would need to change if it's wrong) — but
  this is a real gap, not a formality, until someone runs it against a live session.
- **Mute-confirmation fallback.** The spec's Further Notes flag a contingency: "if the
  live client's lookup does not expose [muting], mutes may fall back to create-call
  success, but blocks must never fall back." No such fallback was built. Reason: whether
  `friendships/show.json` actually returns `relationship.source.muting` on the live
  client was never checked (see the validation gap above), so there was no confirmed
  trigger to build the fallback for. `confirmDirectAction`'s mute path currently reads
  that field the same way the block path reads `blocking`, with no fallback if it's
  ever absent or wrong — an unconfirmed mute will retry, exhaust its budget, and report
  unconfirmed exactly like a block would. If live validation later shows the field
  really is missing, add the fallback then (mutes only; per the spec, blocks must never
  get one).

## Consequences

- A bulk run makes at least twice as many direct-API calls per confirmed account (one
  action POST, one relationship-lookup GET), and up to `MAX_ACCOUNT_ATTEMPTS` times that
  for an account that never confirms — more load on X's API per batch, traded for
  actually knowing the outcome.
- A batch now visibly takes longer when accounts fail or rate-limit, instead of racing
  through a fixed-cadence burst and reporting a possibly-wrong "done."
- The local ledger and cloud backup can now undercount relative to the old behavior in
  the specific case where X accepted the create call but the relationship never actually
  changed (previously silently counted as blocked; now correctly reported unconfirmed
  and left out of the ledger) — this is the intended fix, not a regression.
- Both deviations above (live validation, mute fallback) are follow-up work, not
  something this change can close out inside a keyless content-script extension with no
  live test session.
