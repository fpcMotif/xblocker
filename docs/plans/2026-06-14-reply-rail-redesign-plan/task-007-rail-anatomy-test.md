# Task 007: Rail anatomy + native skin + hidden-zero counts — test (Red)

**type**: test
**depends-on**: ["002", "004"]
**files**:
- `test/content/rail-actions.test.ts` (rewrite selectors/assertions)
- `test/content/rail-state.test.ts` (adjust DOM expectations where needed)

## BDD Scenario

```gherkin
Scenario: Expanded rail shows labeled actions and the native skin
  Given the reply rail is mounted and expanded (state "settled")
  Then the root [data-xb-surface="reply-rail"] contains a header with a grip drag handle
    (aria-label "Move XBlocker rail")
  And a hero block button (aria-label "Block all replies") with visible text "Block all"
  And a secondary mute button (aria-label "Mute all replies") with visible text "Mute all"
  And a footer row with icon-only "Whitelist" and "Open XBlocker settings" buttons
  And a session indicator using the distinct shield glyph
  And the root retains role "toolbar" and aria-label "XBlocker reply actions"
  And it renders NO .xb-handle-count and NO .xb-ring / .xb-ring-bar / .xb-ring-count nodes

Scenario: Bulk counts reflect loaded replies and hide at zero
  Given N reply articles are loaded (N-1 replies, capped at maxReplies)
  When reply counts refresh
  Then the block and mute count chips show that capped count
  And when the count is 0 the chips are absent from the DOM and the a11y tree
  And the footer session indicator is hidden while the session block count is 0

Scenario: Bulk actions still fire
  When the "Block all replies" button is clicked
  Then blockReplies runs (batch wiring unchanged) and a success toast can appear
```

## Steps (what, not how)

1. Update the existing helpers/assertions in `rail-actions.test.ts`: button lookups move
   from `"Block replies"`/`"Mute replies"` to `"Block all replies"`/`"Mute all replies"`;
   count assertions move from `.xb-handle-count`/`.xb-ring-count` to the labeled `.xb-count`
   chips; add assertions that `.xb-handle-count` and `.xb-ring*` no longer exist.
2. Add the hidden-at-zero assertions for the block/mute chips and the session indicator.
3. Keep the existing bulk block/mute behavior assertions (batch wiring is unchanged) but
   retarget them at the renamed buttons; keep `blockReplies`/`muteReplies` isolated via the
   existing fetch/test doubles in `test/helpers`.
4. In `rail-state.test.ts`, retarget any DOM expectations that referenced the old handle
   count; state-transition logic assertions are otherwise unchanged.

## Verification

- `bun test test/content/rail-actions.test.ts test/content/rail-state.test.ts` runs and
  **fails** (Red) because the rail still renders the old DOM.
