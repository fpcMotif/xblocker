# Task 002: Rail state machine impl

**depends-on**: task-002-rail-state-test, task-001-rail-geometry-impl

## Description

Create `entrypoints/content/rail.ts` with the `ReplyRail` class: DOM scaffold
(collapsed handle + expanded stack), the three-state machine, Glide motion, dwell and
collapse timers, and suppression rules. Batch buttons render but their action wiring
is task 003.

## Execution Context

**Task Number**: 002 of 005 (impl half)
**Phase**: Core Features
**Prerequisites**: position.ts API from 001-impl available.

## BDD Scenario

Same scenarios as [task-002-rail-state-test](./task-002-rail-state-test.md) — this
task turns them green.

## Files to Modify/Create

- Create: `entrypoints/content/rail.ts`

## Contract (signatures only — no bodies in this plan)

```ts
export const DWELL_MS = 1000;
export const COLLAPSE_GRACE_MS = 600;
export type RailStateName = "collapsed" | "tracking" | "settled";
export type RailState = { state: RailStateName; rendered: Point; cursor: Point };
export class ReplyRail {
  root: HTMLDivElement;                         // data-xb-surface="reply-rail"
  constructor();
  mount(): void;
  destroy(): void;
  getState(): RailState;
  handleMouseMove(event: MouseEvent): void;     // region detection, dwell anchor, freeze triggers
  handleKeydown(event: KeyboardEvent): void;    // Escape
  handleScroll(): void;                         // re-clamp, re-evaluate region
  step(nowMs?: number): void;                   // one motion/dwell frame; deterministic for tests
}
```

## Steps

### Step 1: Implement (Green)
- Reuse `createActionButton`, `createIcon`, `detectTheme`, styles classes; follow the
  DOM/data-attribute conventions of the old `dock.ts` and `console.ts`
- State changes set `root.dataset.state` and toggle a `settled` lock cue class
  (brighter border + pin dot, per spec)
- Tracking applies `lerp(rendered.y, computeRailY(...), FOLLOW_FACTOR)`; reduced
  motion snaps; rAF loop guards exactly like the old console (`startFollowLoop`)
- Reply region = union of reply article rects via existing `isReplyArticle`
- **Verification**: `bun test test/content/rail-state.test.ts` PASSES

### Step 2: Verify & refactor
- `bun test test/content/position.test.ts test/content/rail-state.test.ts` both green

## Verification Commands

```bash
bun test test/content/rail-state.test.ts
bun test test/content/position.test.ts
```

## Success Criteria

- All 002 scenarios green; no per-author action code anywhere in rail.ts
