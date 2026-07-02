# Task 008: Rail anatomy + native skin + hidden-zero counts — impl (Green)

**type**: impl
**depends-on**: ["007"]
**files**:
- `entrypoints/content/rail.ts`
- `entrypoints/content/styles.ts`

## BDD Scenario

```gherkin
Scenario: Expanded rail shows labeled actions, native skin, and hidden-at-zero counts
  Given the reply rail is mounted and expanded
  Then it renders a header (grip drag handle), a black hero "Block all replies" button,
    an outlined "Mute all replies" button, a footer with icon-only whitelist/settings and a
    shield session indicator, on an opaque X-native surface with a single soft shadow
  And the block/mute count chips show the loaded reply count (<= maxReplies) and are hidden
    from view and the a11y tree when 0
  And the session indicator is hidden while the session block count is 0
  And the old .xb-handle-count and .xb-ring* nodes are gone
```

## Steps (what, not how)

1. Rebuild the `ReplyRail` constructor DOM:
   - Header row: `Replies` label + grip drag handle (keep `attachDrag`, keep aria-label
     "Move XBlocker rail"); drop the handle-count span.
   - Hero block button + outline mute button via `createLabeledActionButton` (Task 002),
     labels "Block all replies"/"Mute all replies", visible text "Block all"/"Mute all",
     wired to the existing `runBatch("block"/"mute")`.
   - Footer row: icon-only whitelist + settings (existing `createActionButton`), plus a
     session indicator (shield glyph + `.xb-session-count`).
2. Replace `updateReplyCounts` count writes to use `setButtonCount` (hidden-at-zero).
3. Replace `incrementBlocked` to update the session indicator and toggle its visibility
   (hidden at 0). Remove `ringBar`/`ringCount`/`handleCount` fields and the ring SVG build.
4. In `styles.ts`: opaque X-native surface (drop glass alpha + blur), single soft shadow,
   hairline border, header/label/footer/session-indicator rules. (Ring/console removal is
   finalized in Task 013.)
5. Keep all state-machine, motion, dwell, drag, and batch logic untouched.

## Verification

- `bun test test/content/rail-actions.test.ts test/content/rail-state.test.ts` passes (Green).
- `bun run typecheck` and `bun run lint` pass.
