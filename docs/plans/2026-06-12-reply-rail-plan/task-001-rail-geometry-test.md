# Task 001: Rail geometry test

**depends-on**: (none)

## Description

Rework `test/content/position.test.ts` to specify the new pure Y-geometry API that
replaces `computeConsolePosition`. Tests must fail (Red) until task 001-impl lands.

## Execution Context

**Task Number**: 001 of 005 (test half)
**Phase**: Foundation
**Prerequisites**: none — pure functions, no DOM or test doubles needed.

## BDD Scenario

```gherkin
Scenario: Rail is vertically centered on the cursor
  Given a rail of height 280 in a 1280x720 viewport
  When computeRailY is called with cursorY 360
  Then it returns 220 (cursor centered on the rail)

Scenario: Rail is clamped to the viewport margins
  Given a rail of height 280 in a 1280x720 viewport
  When computeRailY is called with cursorY 0 or cursorY 720
  Then the result stays within [8, 720 - 280 - 8]

Scenario: Small viewport never produces a negative position
  Given a rail taller than the viewport
  When computeRailY is called with any cursorY
  Then it returns the top margin (8)

Scenario: Jitter below the threshold is not movement
  Given two points 3px apart and a 4px threshold
  When exceedsJitter compares them
  Then it returns false
  And two points 5px apart return true

Scenario: Lerp interpolates by the Glide factor
  Given rendered position 100 and target 200
  When lerp is applied with factor 0.22
  Then it returns 122
```

**Spec Source**: `docs/superpowers/specs/2026-06-12-reply-rail-design.md` § Motion

## Files to Modify/Create

- Modify: `test/content/position.test.ts` (full rewrite of the suite)

## Steps

### Step 1: Write failing tests (Red)
- Import `computeRailY`, `lerp`, `exceedsJitter`, `VIEWPORT_MARGIN`, `FOLLOW_FACTOR` from `entrypoints/content/position`
- One `describe` per scenario above; cover both clamp edges and the equal-to-threshold jitter boundary
- **KEEP the existing `computeConsolePosition` describe block** (mark it `// legacy — removed in task 005`): the function must survive until task 004 rewires index.ts, because `index.ts` imports it and every content-hooks suite transitively loads index.ts. Keeping its tests also keeps the 100% coverage gate satisfiable while it exists.
- **Verification**: `bun test test/content/position.test.ts` FAILS (missing new exports)

## Verification Commands

```bash
bun test test/content/position.test.ts   # must FAIL at this stage
```

## Success Criteria

- Suite describes the new API and fails only because `computeRailY`/`exceedsJitter` do not exist yet (`lerp` and the constants already exist and stay green)
- The legacy `computeConsolePosition` block remains, clearly marked for deletion in 005
