# Plan 011: Design the background block and mute queue, and build its tested core

> **Executor instructions**: This is a design plan with a bounded prototype.
> It does not wire anything into the product. Follow it step by step. Run
> every verification command and confirm the expected result before moving
> on. If anything in the "STOP conditions" section occurs, stop and report.
> Do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- entrypoints/content/actions.ts entrypoints/content/x-api.ts packages/storage/chrome-storage.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. It reads those files and does
> not edit them. If the excerpts under "Current state" no longer match, treat
> it as a STOP condition, because the design rests on them.

## Status

- **Priority**: P2
- **Effort**: M (design answers plus the core module; the full feature is L and is not in this plan)
- **Risk**: LOW (nothing is wired in)
- **Depends on**: plans/003-read-only-outbox-keys.md (for `storageGetByPrefix`)
- **Category**: direction
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

A bulk block or mute runs inside the page's script and stops when the tab closes or reloads; the user must stay on the page until it ends. This plan fixes the design of a durable queue that survives leaving the page, records the decisions that belong to the owner, and builds only the queue's storage core with tests. No user-visible behavior changes in this plan.

## Why this matters

The owner asked for block and mute to finish in the background after they leave a reply thread, and for the cloud backup ("memory" in Convex) to be able to trigger it. Today the batch loop lives in the content script and holds its work list in memory. A page reload loses the rest of the batch with no record that it was pending. A queue stored in `chrome.storage.local` makes the pending work durable, lets any open x.com tab continue it, and gives a later Convex mirror something concrete to mirror.

## Current state

- `entrypoints/content/actions.ts` — `createReplyBatchRunner` (lines 266-351) is the bulk loop. It runs accounts one at a time with a 250 ms pause, and for each account calls `runAccountLifecycle` (lines 226-257): act, then confirm, up to 3 attempts with backoff.
- `entrypoints/content/x-api.ts` — builds the X requests. They need the `ct0` cookie value in an `X-Csrf-Token` header (`requireSessionAuth`, lines 71-89) and are sent with `credentials: "include"` from the x.com page context.
- `packages/storage/blocked-store.ts` — the pattern for durable per-item keys: the sync outbox stores one key per queued action (`blockedOutbox:<actionId>`), so no writer ever reads and rewrites a shared array.
- `docs/adr/0004-bulk-confirm-and-retry.md` — decided: a bulk action counts only after a relationship lookup confirms it; 3 attempts per account; exponential backoff; a larger backoff after HTTP 429; 250 ms pacing between accounts.
- `convex/README.md`, section "No sign-in (single-owner)" — decided and documented: the Convex functions have no authentication, and anyone who knows the deployment URL can read and write the backup.

`entrypoints/content/actions.ts:296-302` today (the work list is a DOM snapshot held in memory):

```ts
      const replies = getConversationReplies().slice(0, settings.maxReplies);
      const whitelist = settings.protectWhitelist
        ? new Set((await getWhitelist()).map((entry) => entry.toLowerCase()))
        : new Set<string>();
      const summary: BatchSummary = { confirmed: 0, skipped: 0, unconfirmed: 0 };
      const unconfirmedHandles: string[] = [];
      for (const [index, article] of replies.entries()) {
```

`entrypoints/content/x-api.ts:83-88` today:

```ts
  const csrfToken = getCookieValue("ct0");
  if (!csrfToken) {
    throw new Error("Missing X CSRF token; open x.com while signed in and try again.");
  }

  return { normalizedUsername, csrfToken };
```

Constraints that follow from these facts:

1. Only a context that can send the user's X session can perform the action. Today that is a content script on x.com. Convex cannot do it: it has no X session, and storing X session cookies in Convex would put account credentials in an unauthenticated database.
2. A queue row is an instruction to block or mute an account. If queue rows are ever read from Convex, an attacker who can write to Convex can make the extension block accounts. The Convex mirror therefore needs authentication first.
3. The service worker might be able to send the requests itself (the manifest already has host permission for `api.x.com`). This is unverified: the `Origin` header would be the extension's, and X may reject it. It needs a manual test in a real browser by the owner.

Repo conventions that bind this work:

- Do not add code comments beyond what the surrounding files do; a repository hook (`doc-lock`) rejects comment changes outside documentation work. This plan was opened as documentation work, but the prototype module should carry intent in names and tests.
- Do not add lint suppressions or `as` type assertions.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every line and branch of the new module needs a test.
- `packages/storage` must not import from `packages/sync`. New package files go at the package root when they are public.
- Vocabulary from `GLOSSARY.md` must be used for existing concepts. Read `GLOSSARY.md` before naming things; if "queue", "job", or "intent" already has a meaning there, report it.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Proposed design

### Queue item

One storage key per item: `actionQueue:<id>`.

```ts
type QueuedAction = {
  id: string;
  kind: "block" | "mute";
  handle: string;
  source: "reply-bar" | "auto";
  queuedAt: number;
  attempts: number;
  notBefore: number;
  state: "pending" | "done" | "failed";
  lastError?: string;
};
```

### Life cycle

```text
┌─────────┐  drain ok + confirmed   ┌──────┐
│ pending │────────────────────────▶│ done │──▶ key removed, blocked store records it
└─────────┘                         └──────┘
     │  attempt failed, attempts < 3
     ├──────────▶ pending (notBefore = now + backoff)
     │  attempts = 3
     └──────────▶ failed (kept for the user to retry or dismiss)
```

### Who drains

Any x.com tab's content script. One tab at a time holds a Web Lock named `xblocker-action-queue` (`navigator.locks` is shared by all tabs of the same origin). The holder takes the oldest `pending` item whose `notBefore` has passed, runs the existing act-then-confirm lifecycle from ADR-0004, and updates or removes the item. Pacing and backoff values come from ADR-0004 unchanged. When the tab closes, the lock is released and another tab, or the next x.com page load, continues.

### What the user sees

The rail's bulk button enqueues every eligible reply at once (after the same whitelist, thread-author, and research-link checks as today) and reports "Queued N". Progress and the final count come from queue changes, so they survive navigation.

### Convex mirror (later, behind authentication)

A `pendingActions` table mirrors queue items so another device can pick them up. It is out of scope until the Convex functions have authentication.

## Decisions that belong to the owner

Put these to the owner as questions in your report. Do not answer them yourself.

1. **Optimistic display**: may the rail mark a reply as handled when it is queued, before X confirms it?
2. **Failed items**: where does the user see and retry items in state `failed`? Options: a row in the popup, a filter in the options Blocked log, or only a toast.
3. **Queue lifetime**: should a pending item expire, for example after 7 days, so an old queue does not act on accounts long after the user chose them?
4. **Service-worker executor**: is the owner willing to run the manual browser test described in step 4?
5. **Convex mirror**: does the owner accept adding sign-in to the Convex backup as the precondition?

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Boundaries | `bun run lint:boundaries` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test packages/storage/tests/action-queue.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `packages/storage/action-queue.ts` (create)
- `packages/storage/tests/action-queue.test.ts` (create)

**Out of scope** (do NOT touch):

- `entrypoints/**` — nothing is wired in by this plan.
- `convex/**` — no table, no function.
- `packages/sync/**`.
- `docs/adr/**` and `GLOSSARY.md` — list the text they should gain in your report.
- `wxt.config.ts` — no new permission.

## Git workflow

- Branch: `advisor/011-design-background-action-queue`
- One commit. Conventional style, for example `feat(storage): add the action queue core`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Read the vocabulary and the bulk-run decision

Read `GLOSSARY.md` and `docs/adr/0004-bulk-confirm-and-retry.md` in full. Note any term that conflicts with "action queue" or "queued action".

**Verify**: your notes name the ADR-0004 constants: `MAX_ACCOUNT_ATTEMPTS = 3`, `RETRY_BASE_DELAY_MS = 500`, `RATE_LIMIT_BASE_DELAY_MS = 4000`, `SCHEDULE_BASE_DELAY_MS = 250` (they are defined in `entrypoints/content/actions.ts:53-64`).

### Step 2: Write the tests for the queue core

Create `packages/storage/tests/action-queue.test.ts`, modeled on `packages/storage/tests/blocked-store.test.ts` (it uses `storageFake` from `test/setup.ts`). Cover:

- `enqueue` writes one `actionQueue:<id>` key per item in a single `storage.set`, and writes nothing for an empty list.
- `enqueue` skips a handle that already has a `pending` item of the same kind.
- `nextDue(now)` returns the oldest `pending` item whose `notBefore <= now`, and `undefined` when none is due.
- `markDone(id)` removes the key.
- `markAttemptFailed(id, error, now, backoffMs)` increments `attempts`, sets `notBefore = now + backoffMs`, keeps `pending` below 3 attempts, and sets `failed` at 3.
- `list()` returns all items sorted by `queuedAt`.
- A failed storage read rejects; it never looks like an empty queue.
- Malformed stored values are ignored by `list()` and `nextDue()`.

**Verify**: `bun test packages/storage/tests/action-queue.test.ts` → all fail (module missing).

### Step 3: Implement the queue core

Create `packages/storage/action-queue.ts` exporting the `QueuedAction` type and a `createActionQueue()` factory with `enqueue`, `nextDue`, `markDone`, `markAttemptFailed`, and `list`. Use `storageGetByPrefix("actionQueue:")`, `storageSet`, and `storageRemove` from `./chrome-storage`. Validate stored values with a type predicate. Serialize mutations within one context with the promise-chain pattern from `createBlockedStore` (`packages/storage/blocked-store.ts:168-174`). The module must not touch the DOM, `fetch`, or `navigator.locks`.

**Verify**:

- `bun test packages/storage/tests/action-queue.test.ts` → all pass
- `bun run typecheck`, `bun run lint`, `bun run lint:boundaries`, `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

### Step 4: Write the manual test procedure for the owner

Do not run this yourself. Put it in your report as numbered steps the owner can follow:

1. Build with `bun run build` and load `.output/chrome-mv3` as an unpacked extension.
2. Open the extension's service-worker console from `chrome://extensions`.
3. On x.com, copy the `ct0` cookie value from DevTools. Do not paste it anywhere except the worker console.
4. In the worker console, send a `GET` to `https://api.x.com/1.1/friendships/show.json?target_screen_name=<any handle>` with `credentials: "include"` and the same headers `sessionAuthHeaders` builds in `entrypoints/content/x-api.ts:93-100`.
5. Report the HTTP status. A 200 means the service worker can act without an x.com tab. A 401 or 403 means it cannot, and the content-script drainer is the design.

**Verify**: your report contains these five steps and the five owner questions.

## Test plan

- The eight cases in step 2, in `packages/storage/tests/action-queue.test.ts`.
- Structural pattern: `packages/storage/tests/blocked-store.test.ts`.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run lint:boundaries`, `bun run format:check` exit 0
- [ ] `bun test` exits 0, coverage threshold met
- [ ] `rg -n "action-queue" entrypoints` returns no matches (nothing is wired in)
- [ ] `git status --short` lists only the two created files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated
- [ ] Your report contains the five owner questions and the manual test procedure

## STOP conditions

Stop and report back if:

- Plan 003 has not landed (`rg -n "storageGetByPrefix" packages/storage/chrome-storage.ts` returns nothing).
- `GLOSSARY.md` already defines a queue, job, or intent concept with a different meaning.
- ADR-0004's constants in `entrypoints/content/actions.ts` differ from the values in step 1.
- You are tempted to edit a file under `entrypoints/` to try the queue out. That is the next plan, written after the owner answers the questions.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The module is unused until a follow-up plan wires the rail and a drainer to it. That follow-up needs the owner's answers to the five questions. If the answers do not come, delete the module instead of leaving it unused.
- The follow-up must update `docs/adr/0004-bulk-confirm-and-retry.md`: the confirm-and-retry rules move from the batch loop to the drainer.
- The Convex mirror must not be built before the Convex functions have authentication. A queue row read from an unauthenticated database is an instruction anyone can forge.
