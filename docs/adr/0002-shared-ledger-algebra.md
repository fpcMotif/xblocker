# ADR-0002 — One source for the blocked-account rollup algebra

- Status: Accepted
- Date: 2026-07-10

## Context

The arithmetic that folds block/mute actions into a blocked-account rollup existed in
three hand-maintained copies, kept equivalent only by comments telling maintainers to
edit them "in lockstep":

1. `entrypoints/lib/blocked-merge.ts` — `mergeBlockedAccount` (local record: append one
   action, +1 the counters) and `foldAccountSnapshot` (pull-side reconciliation: max).
2. `convex/blocked.ts` — `applyRecordAction` (server mutation: same-id +1 upsert,
   alias-row SUM fold, idUnknown AND-clearing), with a "keep the two in lockstep"
   comment.
3. `test/blocked-store.test.ts` — `makeFakeCloud`, a third copy flagged as a "contract
   guard" that must be updated whenever `convex/blocked.ts` changes.

The rules encode three **distinct** fold operators that must never be conflated:

- **apply** (one new action folded into a rollup) → counters **+1**, min/max timestamps,
  `idUnknown` AND.
- **sum** (two separate rows' histories merged because they were wrongly split, e.g. a
  legacy handle row aliased into a numeric-id row) → counters **SUM**.
- **snapshot fold** (two already-rolled-up snapshots of the *same* logical total, on
  pull) → counters **max**.

Tests BS-33/34/35 exist precisely to pin the +1/SUM/max distinction.

## Options considered

### A. Extract the pure algebra into a module shared by both runtimes — CHOSEN

A Convex-expert feasibility probe (2026-07-10) verified that `convex/blocked.ts` can
import pure TypeScript from outside `convex/`:

- Convex's esbuild bundler (`bundle: true`) inlines relative imports that escape
  `convex/`; shared chunks use hash names, so no outbase path failure.
- `convex/tsconfig.json`'s `include` only seeds root files; transitively imported files
  are still type-checked. Import must be a plain extensionless relative path (no
  `paths`, no `allowImportingTsExtensions` in convex's tsconfig).
- `blocked-merge.ts` is dependency-free: no `chrome.*`, no `import.meta`, no WXT virtual
  modules — safe for the Convex isolate runtime, no `"use node"` needed.
- The reverse direction is closed: root `tsconfig.json` and WXT exclude `convex/`, so
  extension bundles never ingest server code.

Shape mismatch is handled by extracting a shape-agnostic `AccountRollup` core (handle,
idUnknown, xUserId, first/lastActionAt, blockCount, muteCount, status) with two pure
functions:

- `applyAccountRollup(existing | undefined, input)` — the +1 operator.
- `sumAccountRollups(target, alias)` — the SUM operator.

`mergeBlockedAccount` becomes a thin wrapper (rollup + `key`/`actions[]` bookkeeping,
which stay client-only); `applyRecordAction` keeps its DB I/O (idempotency check by
`clientActionId`, index lookups, patch/insert/delete) and delegates the arithmetic;
`makeFakeCloud` calls the real exported functions instead of mirroring them.

### B. Golden fixtures executed against both implementations via convex-test — REJECTED (for now)

`convex-test` does not run under `bun test`: its documented setup requires Vite-only
`import.meta.glob` (get-convex/convex-test#9, open) and leans on Vitest `vi.*` timers
and an edge-runtime environment. Adopting it means a second test runner and an
unofficial glob shim next to this repo's bun-only, 100%-coverage suite — a heavy price
for covering only the DB-shaped lines the shared module doesn't reach. Revisit if
upstream lands Bun support.

### C. Both — DEFERRED

Fixture-based cross-checks add little once both runtimes call the same functions.

## Decision

Implement A. `foldAccountSnapshot` (max) stays a separate export and must not be reused
for the alias fold. The lockstep comments in all three files are replaced by pointers to
the shared functions.

## Consequences

- The +1 and SUM operators have exactly one implementation each; a divergence is now a
  compile error or a directly unit-tested function, not a silent drift.
- `convex/blocked.ts` gains a cross-directory import (`../entrypoints/lib/blocked-merge`).
  Future shares from `entrypoints/lib/` must stay dependency-free (no `chrome.*`,
  `import.meta.env`, or WXT virtual modules) or Convex's bundler will fail.
- `applyRecordAction`'s idempotency check and row lookups remain server-only by
  necessity; the shared module does not cover them.
