# Reply Rail visual redesign — implementation plan

Source design: [2026-06-14-reply-rail-redesign-design.md](../../superpowers/specs/2026-06-14-reply-rail-redesign-design.md)
Date: 2026-06-14

## Goal

Reskin the in-page reply rail into an X-native **labeled vertical rail**: black "Block
all" hero, outlined "Mute all", plain-text labels, counts hidden until non-zero, a single
quiet collapsed puck, on-button batch progress, and reliable theme matching. **All
cursor-tracking behavior, motion, dwell, drag, batch logic, and status-page gating are
preserved.** This is a skin + DOM-structure change, not a re-architecture.

## Context

The rail (`entrypoints/content/rail.ts` + `styles.ts`) works but reads as a foreign
object on X: a column of four standing `0`s, a dark three-layer slab on a light page,
five unrelated icons at equal weight, and no visible primary action. The collapsed state
is tracked in the state machine but not yet visually distinct (the full rail always
renders). Theme detection has been observed to misfire (dark rail on a light page).

| Dimension | Current | Target |
|---|---|---|
| Action affordance | 5 icon-only 32px squares, no hierarchy | Labeled "Block all" (black hero) + "Mute all" (outline); whitelist/settings demoted to footer icons |
| Counts at rest | 4 standing zeros (handle, block, mute, ring) | All counts hidden until > 0 |
| Surface | dark glass, 3-layer shadow, blur | opaque X-native surface, single soft shadow, hairline border |
| Collapsed state | same full rail, only `data-state` differs | single circular puck; badge only when > 0 |
| Batch progress | standalone `.xb-ring` strokeDashoffset | on the triggering button (`n / total` + fill); ring removed |
| Theme | misfires dark-on-light | matches X light/dim/dark reliably |
| Tests | assert old DOM (`.xb-handle-count`, `.xb-ring*`, "Block replies") | assert new DOM; 100% coverage gate stays green |

## Execution Plan

```yaml
tasks:
  - id: "001"
    subject: "Labeled action button — test"
    slug: "labeled-button-test"
    type: "test"
    depends-on: []
  - id: "002"
    subject: "Labeled action button — impl"
    slug: "labeled-button-impl"
    type: "impl"
    depends-on: ["001"]
  - id: "003"
    subject: "Distinct shield glyph icon — test"
    slug: "shield-icon-test"
    type: "test"
    depends-on: []
  - id: "004"
    subject: "Distinct shield glyph icon — impl"
    slug: "shield-icon-impl"
    type: "impl"
    depends-on: ["003"]
  - id: "005"
    subject: "Theme detection fidelity — test"
    slug: "theme-detection-test"
    type: "test"
    depends-on: []
  - id: "006"
    subject: "Theme detection fidelity — impl"
    slug: "theme-detection-impl"
    type: "impl"
    depends-on: ["005"]
  - id: "007"
    subject: "Rail anatomy + native skin + hidden-zero counts — test"
    slug: "rail-anatomy-test"
    type: "test"
    depends-on: ["002", "004"]
  - id: "008"
    subject: "Rail anatomy + native skin + hidden-zero counts — impl"
    slug: "rail-anatomy-impl"
    type: "impl"
    depends-on: ["007"]
  - id: "009"
    subject: "Collapsed puck state — test"
    slug: "collapsed-puck-test"
    type: "test"
    depends-on: ["008"]
  - id: "010"
    subject: "Collapsed puck state — impl"
    slug: "collapsed-puck-impl"
    type: "impl"
    depends-on: ["009"]
  - id: "011"
    subject: "On-button batch progress — test"
    slug: "batch-progress-test"
    type: "test"
    depends-on: ["008"]
  - id: "012"
    subject: "On-button batch progress — impl"
    slug: "batch-progress-impl"
    type: "impl"
    depends-on: ["011", "010"]
  - id: "013"
    subject: "Dead-style cleanup + full green gate (100% coverage)"
    slug: "cleanup-gate"
    type: "refactor"
    depends-on: ["006", "010", "012"]
```

## Task File References

- [Task 001: Labeled action button — test](./task-001-labeled-button-test.md)
- [Task 002: Labeled action button — impl](./task-002-labeled-button-impl.md)
- [Task 003: Distinct shield glyph icon — test](./task-003-shield-icon-test.md)
- [Task 004: Distinct shield glyph icon — impl](./task-004-shield-icon-impl.md)
- [Task 005: Theme detection fidelity — test](./task-005-theme-detection-test.md)
- [Task 006: Theme detection fidelity — impl](./task-006-theme-detection-impl.md)
- [Task 007: Rail anatomy + skin + hidden-zero — test](./task-007-rail-anatomy-test.md)
- [Task 008: Rail anatomy + skin + hidden-zero — impl](./task-008-rail-anatomy-impl.md)
- [Task 009: Collapsed puck — test](./task-009-collapsed-puck-test.md)
- [Task 010: Collapsed puck — impl](./task-010-collapsed-puck-impl.md)
- [Task 011: On-button batch progress — test](./task-011-batch-progress-test.md)
- [Task 012: On-button batch progress — impl](./task-012-batch-progress-impl.md)
- [Task 013: Cleanup + full green gate](./task-013-cleanup-gate.md)

## BDD Coverage

| Design behavior | Task(s) |
|---|---|
| Labeled button: icon + text + count chip, state machine preserved, chip hidden at 0 | 001 / 002 |
| Distinct shield glyph (puck + session), not the whitelist shield-check | 003 / 004 |
| Theme matches X light/dim/dark; no dark-on-light misfire | 005 / 006 |
| Expanded rail: header+grip, hero block, outline mute, footer row, native skin, counts ≤ maxReplies, hidden at 0 | 007 / 008 |
| Collapsed: single puck, badge only when > 0, draggable, expands on reply entry | 009 / 010 |
| Batch progress on the triggering button (`n / total` + fill); ring removed; session indicator increments on completion | 011 / 012 |
| Dead styles removed; `bun run check` green at 100% coverage | 013 |

## Dependency Chain

```
(=> "depends on"; [P] = parallelizable group; * = critical path)

Parallel kickoff (no deps):     [P: 001 | 003 | 005]
  001 (button test) => 002 (labeled-button impl) *
  003 (icon test)   => 004 (shield-icon impl)    *
  005 (theme test)  => 006 (theme impl) ───────────┐ (parks until 013)

Rail spine (single file rail.ts/styles.ts — serialized):
  002 ┐
      ├=> 007 (rail test) *=> 008 (rail impl) *
  004 ┘

  008 *=> 009 (puck test)     => 010 (puck impl) * ─┐  [009|011 parallel: different test files]
  008  => 011 (progress test) => 012 (progress impl) *
                                   └ depends-on 010 too (serializes rail.ts/styles.ts edits,
                                     and 012 reuses 010's session-increment) ┘

Gate:
  006 ┐
  010 ┤=> 013 (cleanup + 100% coverage gate) *
  012 ┘

Critical path (8): 001 -> 002 -> 007 -> 008 -> 009 -> 010 -> 012 -> 013
Parallel groups: G1 {001,003,005}  G2 {002,004}  G3 {009,011}  G4 {010 then 012}
```

Note: the impl tasks 008, 010, 012 all edit `entrypoints/content/rail.ts` and `styles.ts`,
so they are deliberately serialized (008 → 010 → 012). Test tasks 009 (`rail-state.test.ts`)
and 011 (`rail-actions.test.ts`) touch different files and may run in parallel after 008.
