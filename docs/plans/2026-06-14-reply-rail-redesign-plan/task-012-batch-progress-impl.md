# Task 012: On-button batch progress — impl (Green)

**type**: impl
**depends-on**: ["011", "010"]
**files**:
- `entrypoints/content/rail.ts`
- `entrypoints/content/buttons.ts`
- `entrypoints/content/styles.ts`

## BDD Scenario

```gherkin
Scenario: Batch progress shows on the triggering button and clears cleanly
  Given a bulk block reporting { done, total }
  When setProgress reports progress
  Then the active button shows "n / total" plus a determinate fill driven by done/total
  When setProgress(null) is called
  Then the button restores its labeled state
  And on completion the session indicator increments and reveals if it was hidden
```

## Steps (what, not how)

1. Re-point `ReplyRail.setProgress` from the removed ring to the active labeled button:
   set a live `n / total` label and a determinate fill (e.g. a `--xb-progress` custom
   property consumed by a CSS pseudo-element width). Track which button is active per
   `runBatch(kind)`.
2. Add the supporting hook to `buttons.ts` (e.g. `setButtonProgress(button, done, total)`
   / `clearButtonProgress(button)`) consistent with the labeled-button structure from
   Task 002.
3. Add the progress-fill CSS to `styles.ts`.
4. Keep `runBatch`, `incrementBlocked`, toast, and batch wiring otherwise unchanged; the
   session indicator increment was added in Task 008/010 — ensure completion still calls it.

## Verification

- `bun test test/content/rail-actions.test.ts` passes (Green).
- `bun run typecheck` and `bun run lint` pass.
