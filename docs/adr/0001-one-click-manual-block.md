# ADR-0001 — One-click manual block ("quick block") technique

- Status: Accepted
- Date: 2026-06-14

## Context

XBlocker can already block/mute **all replies** in one click via the reply rail. The
bulk path calls X's internal web API directly (`blockUserDirectly` / `muteUserDirectly`
in `entrypoints/content/actions.ts`) — instant, no confirmation dialog.

There was no equivalent for blocking **one specific person**. To remove a single
account the user fell back to X's native ••• menu → Block, which shows a confirmation
sheet ("Block @user?") — extra clicks every time. We want the no-confirmation, one-click
"trick" extended to individual ("manual") blocking too, for every kind of block.

CONTEXT.md already names the intended surface — the **Cursor Console**: a per-reply
control that targets the hovered reply's author (block / mute / whitelist that one user).

## Techniques considered

Research into X's current block/mute mechanics (live web-client dispatch tables, two
production extensions, X developer docs, devcommunity threads):

### A. Direct internal v1.1 API per reply (Cursor Console) — CHOSEN DEFAULT

Inject a small per-reply action group; one click calls the existing direct-API
`blockTweet` / `muteTweet` (`POST /1.1/blocks/create.json`, `/1.1/mutes/users/create.json`
with the session bearer + `ct0` CSRF). Instant, silent, no API key.

- The live x.com web client **still uses these v1.1 endpoints** for block/mute — they are
  **not** deprecated and have **not** moved to GraphQL. Confirmed against
  `fa0311/TwitterInternalAPIDocument` (auto-generated from the live client bundle) and the
  Blue-Blocker / `twitter-api-client` projects, which block/mute the same way.
- Fully in-extension: no dependency on X's confirmation markup for the action itself.
- Matches the documented Cursor Console intent.

### B. Auto-confirm X's native confirmation sheet — SHIPPED AS FALLBACK (flagged)

Watch for X's confirmation sheet and auto-click `[data-testid="confirmationSheetConfirm"]`
so the native ••• → Block flow needs no manual confirm.

- Works site-wide (profiles, timeline), not just replies.
- **Fragile / risky**: `confirmationSheetConfirm` is a *generic* testid reused by Delete
  post, Unfollow, Log out, Leave, etc. A blind auto-clicker would confirm the wrong sheet.
  Mute frequently shows **no** sheet at all.
- Scoping is **self-initiated, language-independent**: a capture-phase click listener records
  when the user triggers a block/mute via the menu items `[data-testid="block"]` /
  `[data-testid="mute"]` (these testids are stable across locales), and only a confirmation
  sheet appearing within a short window (`AUTO_CONFIRM_WINDOW_MS`) of that is auto-confirmed.
  Delete/unfollow/log-out sheets are never touched because they come from other menu items.
  An earlier draft matched the **sheet text** for `block|mute`; live testing on a Chinese
  (zh-Hant) UI showed the menu reads "封鎖 @user", so any English-text match silently fails —
  hence the testid-based, self-initiated design.
- Kept as a resilience backstop, not the primary path.

### C. Official X API v2 (`POST /2/users/:id/blocking`) — REJECTED

Requires per-user OAuth 2.0 PKCE consent, registered app + API keys, and a paid tier
(block writes appear gated to Enterprise; Free tier ~1 write/24h). Impractical for a
keyless content-script extension that already has a logged-in session. Not implemented.

## Decision

Implement A and B behind a build-time flag and **default to A**.

- Flag: `VITE_QUICK_BLOCK_MODE` ∈ `inline` (A, default) | `auto-confirm` (B) | `off`.
  Read via `import.meta.env` (same convention as `VITE_CONVEX_URL`); resolved in
  `entrypoints/content/quick-block.ts`. Set it in `.env` and rebuild to compare modes.
- A is the **Cursor Console**: per-reply Block / Mute / Whitelist buttons reusing the
  existing direct-API path; one click, no confirmation.
- B is the scoped auto-confirm observer described above.
- The popup's unused `confirmDestructiveActions` toggle is intentionally left untouched.

## Consequences

- Individual block/mute is one click with no confirmation, consistent with bulk actions.
- Default (A) carries no extra fragility — it reuses the same endpoint the bulk path and
  the live web client use.
- B exists for empirical comparison and as a fallback if X ever breaks the direct call,
  but its reliance on X's markup is documented as a known risk.

## Hardening backlog (not done here)

From the research, future robustness improvements to the direct path: prefer the
same-origin `/i/api/1.1/...` URL over `api.x.com`; capture the bearer token from a live
web-client request instead of hardcoding it; source the numeric `rest_id` from the
already-loaded tweet DOM rather than a separate lookup.
