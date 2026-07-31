# ADR-0003 — One auto-sync policy and an explicit CloudAdapter seam

- Status: Accepted
- Date: 2026-07-10

## Context

"When do we sync" was decided twice and disagreed: the popup gated its auto-sync-on-open
through `shouldAutoSync` (pending-count-or-staleness), while the background scheduler
(`background-sync.ts` → `background.ts`) called `runCloudSync` unconditionally on every
settled debounce and every 30-minute alarm — `shouldAutoSync` was dead weight from the
background's point of view, and a quiet extension still paid a full Convex import + pull
on every alarm.

Separately, the cloud transport seam existed only by accident: tests substituted
`convex-sync.ts` via `bun mock.module` (a module-path trick), and the Convex wire-format
mapping (`RecordActionArgs`, `outboxItemToRecordArgs`, `outboxToRecordBatches`) lived in
`blocked-store.ts` for test convenience even though `convex-sync.ts` declares itself the
only Convex-aware module. `clearCloud` was exported with zero callers.

A three-lens design panel (minimal-churn / maximum-depth / testability-first, 2026-07-10)
produced the alternatives below.

## Options considered

### A. Maximum depth: one `SyncEngine` object, delete `background-sync.ts` — REJECTED (for now)

`createSyncEngine(deps)` with `requestSync(reason)` absorbing debounce, staleness,
enablement, and adapter selection. Deepest interface, but it deletes the MV3 due-at
persistence freshly added to `background-sync.ts` and rewrites the popup cloud section
during an active popup redesign — maximal collision with in-flight work for a payoff the
smaller design also reaches. Revisit if the sync surface grows again.

### B. Minimal churn: optional `loadAdapter` param + `isSyncDue`/`syncIfDue` — PARTIALLY ADOPTED

Unifies policy with two small composing functions and two call-site edits, but keeps
`mock.module` in the popup tests and leaves the adapter implicit on the default path.

### C. Testability-first: `CloudAdapter` as a value parameter, `runAutoCloudSync` gate — ADOPTED (scoped)

The adapter seam becomes an explicit type; every automatic trigger flows through one
gate; engine tests inject plain object fakes, no `mock.module`.

## Decision

Adopt C's core, scoped by B's collision discipline:

- `sync-engine.ts` exports `CloudAdapter` (`isConfigured` / `push` / `pull`, spoken in
  the store's own vocabulary — `OutboxItem` in, accepted ids out, `RemoteAccount[]` on
  pull; the Convex wire shape never crosses this seam). `runCloudSync` gains an optional
  `loadAdapter` parameter defaulting to a lazy `import("./convex-sync")` → `convexAdapter`,
  preserving today's popup-render-fast laziness. New `runAutoCloudSync(enabled, now?,
  loadAdapter?)` is THE gate for every automatic trigger: it reads fresh pending + meta,
  consults `shouldAutoSync` (unchanged, still the one written-down policy), and returns
  `{ status: "skipped" }` **without loading the adapter** when not due — a quiet alarm
  costs no Convex import and no network.
- `convex-sync.ts` exports `convexAdapter satisfies CloudAdapter`.
- The wire-format mapping moves verbatim to a new pure `lib/cloud-wire.ts`
  (no chrome.*, no Convex SDK); `convex-sync.ts` imports it; `blocked-store.ts` drops it.
- `background.ts` re-points its scheduler dep: `sync: () => runAutoCloudSync(true)`.
  This is the whole policy unification — the background's debounce/alarm/eviction
  machinery in `background-sync.ts` is untouched (it recently gained persisted
  `syncDueAt` catch-up and is owned by in-flight work).
- `popup/main.ts` is NOT edited: it already consults `shouldAutoSync`; the divergence
  was only ever the background's missing gate. Its `mock.module`-based tests are
  accepted as temporary debt until the in-flight popup redesign settles (tracked in the
  wiring-review task), after which the popup should take a `loadCloudAdapter` dep.
- `clearCloud` stays exported but unwired: its natural consumer is the settings page in
  the gauge-and-ledger plan (docs/plans/2026-07-10-gauge-and-ledger/); wire it there or
  delete it when that page ships.

Behavior change (intended): a periodic alarm or caught-up debounce with an empty outbox
and a fresh `lastSyncAt` now skips instead of running a full push+pull+merge. Manual
"Sync now" remains unconditional.

### Revision (2026-07-15) — complete the deferred Cloud backup seam

The popup and settings redesign has shipped, so the temporary caller-owned orchestration
above is retired. `lib/cloud-backup.ts` now exposes one deep `CloudBackup` interface:
`inspect()` returns the current projection and `act(intent)` owns manual/automatic sync,
enablement, and wipe. Popup, settings, and background depend on that same interface.

`CloudAdapter` now also includes `clear`; `convexAdapter` and plain test adapters satisfy
the same seam. Build configuration moved to the small `cloud-config.ts` module, so
`inspect()` and skipped automatic work do not import the Convex client.

Cloud operations acquire one same-origin Web Lock across popup, settings, and the MV3
worker. Because content scripts have the host page's origin, their ledger writes route
through a runtime-message bridge to the background owner; all local ledger mutations can
then use a separate extension-origin Web Lock. This closes the cross-context
read-modify-write race without nesting locks in conflicting order. Wipe first durably
turns backup off, then captures the pending action ids, clears remote rows, drains only
that captured set, and resets sync metadata. Lifecycle-critical storage writes reject on
`chrome.runtime.lastError`; a partial wipe therefore fails visibly while remaining safely
disabled. Every `act()` result includes the resulting `CloudBackupSnapshot`, so surfaces
render the module's projection instead of reconstructing lifecycle state.

The process-global `mock.module` seams in popup and settings tests are removed in favor
of injected `CloudBackup` values. MV3 debounce, persisted due-at, alarm, and catch-up
behavior remain in `background-sync.ts`; the scheduler only signals an automatic sync,
leaving enablement, freshness, configuration, and pending-work policy in Cloud backup.

## Consequences

- One policy, written once, consulted by every automatic trigger; tested at one seam.
- Two real adapters at the cloud seam: `convexAdapter` in production, plain object
  literals in `test/cloud-backup.test.ts`. No process-global module mocking is needed.
- `blocked-store.ts` stops carrying Convex vocabulary; `cloud-wire.ts` is importable by
  tests and `convex-sync.ts` without pulling in storage or the SDK.
- Popup and settings tests now cross the same `CloudBackup` interface as production
  callers; no test duplicates the private Convex module shape.
