# Task 001: Rail geometry impl

**depends-on**: task-001-rail-geometry-test

## Description

Rewrite `entrypoints/content/position.ts` as the pure Y-geometry module for the rail.
Remove the X/flip logic that only the deleted cursor console used.

## Execution Context

**Task Number**: 001 of 005 (impl half)
**Phase**: Foundation
**Prerequisites**: task-001-rail-geometry-test merged and failing.

## BDD Scenario

Same scenarios as [task-001-rail-geometry-test](./task-001-rail-geometry-test.md) —
this task turns them green.

## Files to Modify/Create

- Modify: `entrypoints/content/position.ts` (full rewrite)

## Contract (signatures only — no bodies in this plan)

```ts
export const VIEWPORT_MARGIN = 8;
export const FOLLOW_FACTOR = 0.22;       // Glide, decided by prototype
export const JITTER_PX = 4;
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export function lerp(from: number, to: number, factor: number): number;
export function computeRailY(cursorY: number, railHeight: number, viewport: Size): number;
export function exceedsJitter(a: Point, b: Point, threshold?: number): boolean;
```

## Steps

### Step 1: Implement (Green)
- `computeRailY` centers the rail on `cursorY` and clamps to `[VIEWPORT_MARGIN, viewport.height - railHeight - VIEWPORT_MARGIN]`, never below the top margin
- `exceedsJitter` uses Euclidean distance against `JITTER_PX` by default
- **KEEP `computeConsolePosition` (and its types/constants) exported and unchanged**,
  with a `// legacy — removed in task 005` marker. index.ts imports it; deleting it
  here would break every content-hooks-based suite until task 004. It is deleted in
  task 005 after 004 removes the last import.
- **Verification**: `bun test test/content/position.test.ts` PASSES

### Step 2: Verify no regressions
- `bun test` (full suite) must remain green after this task — that is the point of
  keeping the legacy export.

## Verification Commands

```bash
bun test test/content/position.test.ts
bun test   # full suite stays green thanks to the retained legacy export
```

## Success Criteria

- position.test.ts green; full suite green; module has no DOM or browser dependencies
