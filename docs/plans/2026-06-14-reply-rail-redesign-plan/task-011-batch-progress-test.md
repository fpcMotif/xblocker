# Task 011: On-button batch progress — test (Red)

**type**: test
**depends-on**: ["008"]
**files**:
- `test/content/rail-actions.test.ts`

## BDD Scenario

```gherkin
Scenario: Batch progress shows on the triggering button
  Given a bulk block is running and reports progress { done, total }
  When setProgress({ done, total }) is called
  Then the active "Block all replies" button shows a live "n / total" indication
  And a determinate progress fill on that button reflects done/total
  And no .xb-ring / .xb-ring-bar node is queried or updated (the ring is gone)

Scenario: Clearing progress restores the button label
  Given a button showing batch progress
  When setProgress(null) is called
  Then the button returns to its labeled state ("Block all" + count chip)

Scenario: Completion increments the session indicator
  Given a successful bulk block of N replies
  When the batch completes
  Then the session indicator increments by N and becomes visible if it was hidden
  And the existing success toast fires

Scenario: A mute batch does not touch the session indicator (block-only rule)
  Given a successful bulk mute of M replies
  When the batch completes
  Then the session indicator is unchanged (mute never increments the blocked-this-session count)
```

## Steps (what, not how)

1. In `rail-actions.test.ts`, replace the `.xb-ring-bar` `strokeDashoffset` progress
   assertions with assertions on the active button: the `n / total` text and the
   determinate fill (assert the data attribute / style contract the impl exposes, e.g.
   `--xb-progress` or a width).
2. Assert `setProgress(null)` restores the labeled state, and that completion increments
   and reveals the session indicator. Keep batch isolation via the existing test doubles.

## Verification

- `bun test test/content/rail-actions.test.ts` runs and **fails** (Red): progress still
  targets the removed ring rather than the button.
