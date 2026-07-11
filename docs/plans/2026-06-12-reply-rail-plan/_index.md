# Reply Rail Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Load `superpowers:executing-plans` skill using the Skill tool to implement this plan task-by-task.

**Goal:** Replace the per-author cursor console and the static dock with a single bulk-only Reply Rail that tracks the cursor's height in reply mode and settles when the user pauses or reaches for it.

**Architecture:** One content-script surface (`ReplyRail` in `entrypoints/content/rail.ts`) driven by a three-state machine (collapsed / tracking / settled). Pure Y-geometry lives in `position.ts` for unit testing; DOM, timers, and batch actions live in `rail.ts`; `index.ts` only wires listeners and test hooks. Motion is Glide: damped lerp (factor 0.22) on the Y axis only.

**Tech Stack:** WXT content script, TypeScript, bun test + happy-dom, oxlint/oxfmt/tsgo. bun/bunx only — never npm/npx.

**Design Support:**
- [Design spec](../../superpowers/specs/2026-06-12-reply-rail-design.md) (single-file spec; BDD scenarios are embedded in each task file below)

## Context

The cursor-following per-author console is unclickable by construction (it sits at a fixed offset from the cursor), and the user's actual goal is bulk block/mute of reply accounts. The approved design (user-validated via a motion prototype; Glide won) merges both surfaces into one rail. Constraints: `bun run check` must stay fully green with **100% test coverage**; concurrent sessions may mutate this repo mid-task, so commits must stage only the files each task touches.

| Aspect | Current State | Target State |
|--------|--------------|--------------|
| Surfaces | `CursorConsole` (follows cursor, per-author) + `Dock` (static rail, batch) | Single `ReplyRail` (collapsed handle ⇄ Y-tracking rail, batch-only) |
| Per-author actions | Block/Mute/Whitelist on hovered reply | Removed entirely |
| Geometry module | `computeConsolePosition` (X+Y, flip logic) | `computeRailY` (Y-only clamp), `lerp`, `exceedsJitter` |
| Files | `console.ts`, `dock.ts`, `position.ts` | `rail.ts`, `position.ts` (console.ts and dock.ts deleted) |
| Test hooks | `getCursorConsole()`, `getDock()`, `computeConsolePosition`, `consoleGraceMs` | `getRail()`, `computeRailY`, `railTimings` |
| Tests | `cursor-console.test.ts`, `dock.test.ts`, `position.test.ts` | `rail-state.test.ts`, `rail-actions.test.ts`, `position.test.ts` (reworked) |

Notes for executors: (1) `bunfig.toml` sets `coverage = true` with `coverageThreshold = 1.0`,
so even targeted `bun test <file>` runs report threshold failures for partially-loaded
modules — judge Red/Green by test pass/fail; the coverage gate is only meaningful on the
full `bun test` run. (2) The spec named a single `rail.test.ts`; this plan deliberately
splits it into `rail-state.test.ts` + `rail-actions.test.ts` so tasks 002/003 own separate
files. (3) Some 003 scenarios (failure toasts, off-screen clamp, timeline gating in 004)
encode existing dock/index behavior parity rather than spec text — they are intentional.

## Execution Plan

```yaml
tasks:
  - id: "001-test"
    subject: "Rail geometry test"
    slug: "rail-geometry-test"
    type: "test"
    depends-on: []
  - id: "001-impl"
    subject: "Rail geometry impl"
    slug: "rail-geometry-impl"
    type: "impl"
    depends-on: ["001-test"]
  - id: "002-test"
    subject: "Rail state machine test"
    slug: "rail-state-test"
    type: "test"
    depends-on: []
  - id: "002-impl"
    subject: "Rail state machine impl"
    slug: "rail-state-impl"
    type: "impl"
    depends-on: ["002-test", "001-impl"]
  - id: "003-test"
    subject: "Rail actions test"
    slug: "rail-actions-test"
    type: "test"
    depends-on: []
  - id: "003-impl"
    subject: "Rail actions impl"
    slug: "rail-actions-impl"
    type: "impl"
    depends-on: ["003-test", "002-impl"]
  - id: "004-test"
    subject: "Content wiring test"
    slug: "content-wiring-test"
    type: "test"
    depends-on: []
  - id: "004-impl"
    subject: "Content wiring impl"
    slug: "content-wiring-impl"
    type: "impl"
    depends-on: ["004-test", "002-impl", "003-impl"]
  - id: "005"
    subject: "Cleanup and gate"
    slug: "cleanup-gate"
    type: "refactor"
    depends-on: ["001-impl", "002-impl", "003-impl", "004-impl"]
```

**Task File References (for detailed BDD scenarios):**
- [Task 001: Rail geometry test](./task-001-rail-geometry-test.md)
- [Task 001: Rail geometry impl](./task-001-rail-geometry-impl.md)
- [Task 002: Rail state machine test](./task-002-rail-state-test.md)
- [Task 002: Rail state machine impl](./task-002-rail-state-impl.md)
- [Task 003: Rail actions test](./task-003-rail-actions-test.md)
- [Task 003: Rail actions impl](./task-003-rail-actions-impl.md)
- [Task 004: Content wiring test](./task-004-content-wiring-test.md)
- [Task 004: Content wiring impl](./task-004-content-wiring-impl.md)
- [Task 005: Cleanup and gate](./task-005-cleanup-gate.md)

## BDD Coverage

Every behavior in the design spec maps to a task: Y-geometry and jitter (001), the
collapsed/tracking/settled state machine with dwell, leave-column, hover, grace,
Escape, suppression, and reduced motion (002), bulk batch actions, counts, ring,
session counter, whitelist modal, and drag persistence (003), entrypoint wiring,
URL gating, and test hooks (004), deletion of the old surfaces and the full
`bun run check` + 100% coverage gate (005).

## Dependency Chain

```
001-test ──→ 001-impl ──┐
002-test ───────────────┴─→ 002-impl ──┐
003-test ──────────────────────────────┴─→ 003-impl ──┐
004-test ──────────────────────────────────────────────┴─→ 004-impl ──→ 005
```
(Redundant defensive edges not drawn: 004-impl→002-impl; 005→001/002/003-impl.)

**Analysis**:
- No circular dependencies.
- All four test (Red) tasks are technically independent; `test/helpers/content-hooks.ts`
  is owned by 002-test alone, so they may run in parallel. Exception by policy:
  004-test should land immediately before 004-impl (it reddens two live suites).
- `rail.ts` is owned serially: 002-impl creates it, 003-impl extends it.
- Green-tree strategy: 001-impl keeps a legacy `computeConsolePosition` export (and its
  tests) so the full suite stays green through tasks 001–003; the only intentional red
  window is 004-test → 005.
- 005 is the only task allowed to delete files; nothing depends on it.

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-06-12-reply-rail-plan/`. Execution options:**

**1. Orchestrated Execution (Recommended)** - Load `superpowers:executing-plans` skill using the Skill tool.

**2. Direct Agent Team** - Load `superpowers:agent-team-driven-development` skill using the Skill tool.

**3. BDD-Focused Execution** - Load `superpowers:behavior-driven-development` skill using the Skill tool for specific scenarios.
