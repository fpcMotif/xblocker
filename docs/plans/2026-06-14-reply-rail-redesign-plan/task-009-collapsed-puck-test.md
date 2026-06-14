# Task 009: Collapsed puck state — test (Red)

**type**: test
**depends-on**: ["008"]
**files**:
- `test/content/rail-state.test.ts`

## BDD Scenario

```gherkin
Scenario: Collapsed state shows a single puck
  Given the reply rail in the "collapsed" state (data-state "collapsed")
  Then the collapsed puck is the visible surface and the expanded body is hidden
  And the puck shows the session-blocked count badge only when the count > 0
  And the puck carries aria-label "XBlocker — N blocked this session" (N = session count)
  And the puck remains draggable (the drag handle still moves the rail)

Scenario: Entering the reply region expands the rail
  Given a collapsed rail
  When the cursor enters the reply region (existing tracking transition)
  Then the rail enters "tracking" and the labeled rail body is visible
```

## Steps (what, not how)

1. In `rail-state.test.ts`, add assertions that in `collapsed` state the puck element is
   present/visible and the expanded body is hidden (via a `data-state`-keyed class or
   `hidden` attribute — assert the contract, not the CSS).
2. Assert the puck badge is hidden when session count is 0 and shown after a block.
3. Reuse the existing transition drivers (the deterministic `step()` + fake timers and the
   existing reply-region `handleMouseMove` helpers) to assert collapsed → tracking expands
   the body. Keep all timing helpers from `test/helpers/timers.ts`.

## Verification

- `bun test test/content/rail-state.test.ts` runs and **fails** (Red): the puck markup /
  visibility toggle does not exist yet.
