# Task 004: Content wiring impl

**depends-on**: task-004-content-wiring-test, task-002-rail-state-impl, task-003-rail-actions-impl

## Description

Rewire `entrypoints/content/index.ts` to mount only the ReplyRail, forward global
listeners to it, and update the test-hook surface.

## Execution Context

**Task Number**: 004 of 005 (impl half)
**Phase**: Integration
**Prerequisites**: rail.ts complete (002+003 impl).

## BDD Scenario

Same scenarios as [task-004-content-wiring-test](./task-004-content-wiring-test.md) —
this task turns them green.

## Files to Modify/Create

- Modify: `entrypoints/content/index.ts`

## Steps

### Step 1: Implement (Green)
- Remove `CursorConsole` and `Dock` imports/wiring; instantiate `ReplyRail` in
  `addButtons`; forward mousemove/scroll/keydown to the rail (same passive options as
  today); keep the URL-pattern gating logic untouched
- Hooks: add `getRail`, `computeRailY`, `railTimings`; delete `getCursorConsole`,
  `getDock`, `computeConsolePosition`, `consoleGraceMs`; keep all unrelated hooks
  (direct block/mute, username, cookies, maxReplies) byte-identical
- Do not delete console.ts/dock.ts files yet (task 005)
- **Verification**: 004 suites PASS

### Step 2: Verify & refactor
- Full content test directory run; only the suites scheduled for deletion in 005
  (`cursor-console.test.ts`, `dock.test.ts`) may still fail

## Verification Commands

```bash
bun test test/content/page-lifecycle.test.ts test/content/ui-rendering.test.ts
bun test test/content
```

## Success Criteria

- One surface mounted per page; hook surface matches the test exactly
