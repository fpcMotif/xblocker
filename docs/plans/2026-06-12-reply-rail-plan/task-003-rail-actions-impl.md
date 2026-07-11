# Task 003: Rail actions impl

**depends-on**: task-003-rail-actions-test, task-002-rail-state-impl

## Description

Extend `entrypoints/content/rail.ts` (created in 002-impl; this task serializes after
it because both touch the same file) with batch wiring, counts, ring progress, session
counter, whitelist modal, settings toast, and drag persistence — ported from `dock.ts`.

## Execution Context

**Task Number**: 003 of 005 (impl half)
**Phase**: Core Features
**Prerequisites**: ReplyRail state machine merged.

## BDD Scenario

Same scenarios as [task-003-rail-actions-test](./task-003-rail-actions-test.md) — this
task turns them green.

## Files to Modify/Create

- Modify: `entrypoints/content/rail.ts`

## Contract additions (signatures only)

```ts
export class ReplyRail {
  incrementBlocked(by?: number): void;
  setProgress(progress: BatchProgress | null): void;
  refreshReplyCounts(): void;     // updates block/mute count badges from the DOM
}
```

## Steps

### Step 1: Implement (Green)
- Move `loadDockPosition` / `saveDockPosition` / `attachDrag` / ring construction /
  `runBlockBatch` / `runMuteBatch` over from `dock.ts` (keep the `dockPosition`
  storage key for backward compatibility); do not delete dock.ts yet (task 005)
- While a batch runs: force settled state, suspend tracking, animate ring (already
  asserted in 002's batch-pin scenario)
- **Verification**: `bun test test/content/rail-actions.test.ts` PASSES

### Step 2: Verify & refactor
- All rail and position suites green together

## Verification Commands

```bash
bun test test/content/rail-actions.test.ts
bun test test/content/rail-state.test.ts test/content/position.test.ts
```

## Success Criteria

- 003 scenarios green; storage key unchanged; no duplicated batch logic left ambiguous between rail.ts and dock.ts (dock.ts untouched, deleted in 005)
