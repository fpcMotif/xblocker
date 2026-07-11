# Task 002: Rail state machine test

**depends-on**: (none)

## Description

Create `test/content/rail-state.test.ts` specifying the collapsed / tracking / settled
state machine of `ReplyRail`. Uses happy-dom plus the deterministic hooks `step(nowMs)`
and injected timings — no real rAF waits or sleeps. External dependencies (chrome
storage, batch actions) are test doubles via the existing `test/helpers/content-hooks.ts`
patterns.

## Execution Context

**Task Number**: 002 of 005 (test half)
**Phase**: Core Features
**Prerequisites**: none (imports `entrypoints/content/rail` which does not exist yet — Red).

## BDD Scenario

```gherkin
Scenario: Rail starts collapsed at its home position
  Given a mounted ReplyRail
  Then its root has data-state "collapsed"
  And only the handle (with session count badge) is interactive

Scenario: Entering the reply region expands to tracking
  Given a tweet page with a main tweet and reply articles
  When a mousemove lands inside a reply article
  Then the rail state becomes "tracking"
  And subsequent step() calls move rendered Y toward computeRailY(cursorY)

Scenario: Pausing one second settles the rail
  Given the rail is tracking and the cursor stops moving
  When step(now + 1000) is called
  Then the state becomes "settled"
  And the root carries the settled lock cue (data-state "settled" drives the brighter border + pin dot)
  And rendered Y no longer changes on further step() calls

Scenario: Sub-jitter movement does not reset the dwell timer
  Given the rail is tracking
  When the cursor moves 3px and step(now + 1000) is called
  Then the state is "settled"

Scenario: Leaving the reply column toward the rail settles immediately
  Given the rail is tracking
  When a mousemove lands outside the replies and outside the rail
  Then the state becomes "settled"
  And after 600ms without re-entry the state becomes "collapsed"

Scenario: Hovering the rail keeps it settled and cancels collapse
  Given the rail is settled with a pending collapse timer
  When a mousemove lands on the rail itself
  Then the collapse timer is cancelled and the state stays "settled"

Scenario: Moving inside the replies resumes tracking
  Given the rail is settled
  When the cursor moves more than 4px inside a reply article
  Then the state becomes "tracking"

Scenario: Escape collapses from any expanded state
  Given the rail is tracking or settled
  When the Escape key is pressed
  Then the state becomes "collapsed"

Scenario: Inputs and modals suppress the rail
  Given the cursor is inside an input, textarea, contenteditable, or an aria-modal dialog is open
  When a mousemove occurs in the reply region
  Then the rail collapses (or stays collapsed)

Scenario: The main tweet is not the reply region
  Given a tweet detail page where the first article is the main tweet
  When a mousemove lands inside the main tweet article
  Then the rail stays collapsed

Scenario: Scrolling re-clamps without collapsing
  Given the rail is tracking or settled near the viewport edge
  When a scroll event fires
  Then the state is unchanged
  And the next step() clamps rendered Y back inside the viewport margins

Scenario: Reduced motion snaps instead of gliding
  Given prefers-reduced-motion is "reduce"
  When step() runs while tracking
  Then rendered Y equals the target exactly after one step

Scenario: A running batch pins the rail
  Given a batch is running (batchState.running is true)
  When mousemoves occur inside the replies
  Then the state stays "settled" until the batch ends
```

**Spec Source**: `docs/superpowers/specs/2026-06-12-reply-rail-design.md` § States, § Motion, § Reply-mode detection

## Files to Modify/Create

- Create: `test/content/rail-state.test.ts`
- Modify (if needed): `test/helpers/content-hooks.ts` — DOM fixture builder for a thread with N replies

## Steps

### Step 1: Write failing tests (Red)
- Drive time explicitly: `rail.step(nowMs)` for motion/dwell, `setTimeout` faked via bun's fake timers for the 600ms collapse grace
- Assert state via `rail.getState()` and `root.dataset.state`
- **Verification**: `bun test test/content/rail-state.test.ts` FAILS (module missing)

## Verification Commands

```bash
bun test test/content/rail-state.test.ts   # must FAIL at this stage
```

## Success Criteria

- Every scenario above has at least one test; no real-time sleeps; chrome APIs stubbed
