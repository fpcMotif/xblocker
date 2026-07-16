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

## Consequences

- One policy, written once, consulted by every automatic trigger; tested at one seam.
- Two real adapters at the cloud seam: `convexAdapter` in production, plain object
  literals in engine tests. `mock.module` disappears from `test/sync-engine.test.ts`.
- `blocked-store.ts` stops carrying Convex vocabulary; `cloud-wire.ts` is importable by
  tests and `convex-sync.ts` without pulling in storage or the SDK.
- The popup test seam is deliberately deferred — do not "fix" it mid-redesign.

## Update (2026-07-15) — deferred items landed

The two consciously-deferred pieces above are done (architecture-deepening pass, Track B):

- Both the popup and the settings cloud pane now take the transport as a
  `loadAdapter: () => Promise<CloudAdapter>` port (default `loadConvexAdapter`, now
  **exported** from `sync-engine.ts`). `mock.module` is gone from
  `test/popup/cloud-backup.test.ts` and `test/options/cloud.test.ts`; both inject plain
  object fakes, exactly like the engine tests — the "popup test seam is deferred" debt is
  retired. The popup's open-time auto-sync flows through `runAutoCloudSync` (the single
  gate) rather than a hand-rolled `shouldAutoSync` copy.
- `CloudAdapter` gained `clear()`; `convexAdapter` wires it to `clearCloud`, and the
  pane's wipe now calls `adapter.clear()` through the port instead of lazy-importing
  convex-sync directly. `clearCloud` is now module-private (reached only via the port),
  not the unwired export it used to be.
- New `readCloudDisplayState()` is the one storage read (enabled / meta / pending) both
  surfaces render their initial rows from. `readCloudStatus(loadAdapter?)` layers the
  adapter's `configured` flag on top for the popup, which holds no adapter yet; the settings
  pane loads its adapter up front (it needs it for the wipe) and reads `readCloudDisplayState`
  directly, so it neither re-loads nor re-checks the adapter.

## Update (2026-07-16) — pre-read snapshot threading

The popup's open path used to read the same two keys (pending outbox + sync meta) two to
three times: once in `readCloudStatus` for display, again inside `runAutoCloudSync`'s
gate, and a third time in `runCloudSync` when a sync was actually due. The reads are now
threaded instead of repeated:

- `SyncSnapshot` (`{ pending, meta }`) names one point-in-time read of the sync inputs.
  `readCloudDisplayState` / `readCloudStatus` return the pending **items** (callers count
  them for display), so the same read doubles as the snapshot.
- `runAutoCloudSync` accepts an optional pre-read `snapshot`; the popup passes the
  `readCloudStatus` result straight in, so opening the popup reads pending/meta exactly
  once. Callers without a fresh read (the background worker) omit it and the gate reads
  for itself, as before.
- The gate threads whichever pending list it decided on into `runCloudSync`
  (optional `preReadPending`), which therefore never re-reads the outbox on an automatic
  sync. Manual "Sync now" still omits it and reads fresh at click time. A stale-list race
  is harmless by construction: `markSynced` drops entries by action id, so an action
  recorded after the snapshot just stays queued for the next trigger.
