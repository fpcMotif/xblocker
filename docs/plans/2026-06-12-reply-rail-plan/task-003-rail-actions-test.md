# Task 003: Rail actions test

**depends-on**: (none)

## Description

Create `test/content/rail-actions.test.ts` specifying the rail's batch actions, counts,
progress ring, drag persistence, and auxiliary buttons. Network/automation is isolated:
`blockReplies` / `muteReplies` interactions go through the same fetch/DOM stubs the
existing `bulk-actions.test.ts` uses; `chrome.storage.local` is the in-memory stub from
`test/setup.ts`.

## Execution Context

**Task Number**: 003 of 005 (test half)
**Phase**: Core Features
**Prerequisites**: none (Red against the not-yet-extended rail API).

## BDD Scenario

```gherkin
Scenario: Bulk buttons show the loaded reply count
  Given a thread with 5 reply articles and maxReplies 100
  When the rail expands
  Then the block and mute buttons each show a count of 5

Scenario: Counts are capped by maxReplies
  Given a thread with 5 reply articles and maxReplies 3
  When the rail expands
  Then the block and mute buttons each show a count of 3

Scenario: Bulk block runs the batch and reports progress
  Given a settled rail and 3 blockable replies
  When the bulk block button is clicked
  Then blockReplies runs with a progress callback
  And the ring's stroke-dashoffset advances with each progress tick
  And the session counter increases by the number of acted replies
  And a success toast summarizes acted/skipped counts

Scenario: Bulk mute failure surfaces a warning
  Given the direct mute endpoint fails for every reply
  When the bulk mute button is clicked
  Then a warning toast asks the user to stay signed in
  And the batch promise rejects (matching existing dock semantics)

Scenario: Whitelist and settings buttons behave like the old dock
  When the whitelist button is clicked, the whitelist modal opens
  When the settings button is clicked, an info toast points to the popup

Scenario: Dragging the handle persists the home position
  Given a mounted rail
  When the drag handle is pointer-dragged to (40, 100) and released
  Then chrome.storage.local holds dockPosition {x: 40, y: 100}
  And a freshly mounted rail clamps a stored off-screen position back into the viewport

Scenario: Session count survives collapse
  Given 4 accounts were blocked this session
  When the rail collapses
  Then the handle badge shows 4
```

**Spec Source**: `docs/superpowers/specs/2026-06-12-reply-rail-design.md` § Rail anatomy

## Files to Modify/Create

- Create: `test/content/rail-actions.test.ts`

## Steps

### Step 1: Write failing tests (Red)
- Port the still-valid assertions from `test/content/dock.test.ts` (batch flows, ring,
  drag persistence) onto the new rail selectors; add the count-badge and handle-badge
  scenarios
- **Verification**: `bun test test/content/rail-actions.test.ts` FAILS

## Verification Commands

```bash
bun test test/content/rail-actions.test.ts   # must FAIL at this stage
```

## Success Criteria

- Every scenario covered; all external effects stubbed (fetch, storage, timers)
