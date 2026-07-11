# Task 010: Collapsed puck state — impl (Green)

**type**: impl
**depends-on**: ["009"]
**files**:
- `entrypoints/content/rail.ts`
- `entrypoints/content/styles.ts`

## BDD Scenario

```gherkin
Scenario: Collapsed state shows a single puck that expands on reply entry
  Given the reply rail in the "collapsed" state
  Then only the puck (shield glyph + session badge, badge hidden at 0) is visible and the
    expanded body is hidden, and the puck is draggable
  When the cursor enters the reply region
  Then the rail enters "tracking" and the expanded labeled body is shown
```

## Steps (what, not how)

1. Add a collapsed puck element (circular, shield glyph, corner session badge) to the rail
   DOM; the badge reuses the session count and hidden-at-zero rule from Task 008. Set and
   keep the puck `aria-label` updated to `XBlocker — N blocked this session` (N = session
   count), so the collapsed surface is described without the visible labels.
2. Add `[data-state="collapsed"]` styling in `styles.ts` that shows the puck and hides the
   expanded body; non-collapsed states show the body and hide the puck. Expand/collapse is
   opacity-based under `prefers-reduced-motion`.
3. Ensure the drag handle (or the puck itself) keeps `attachDrag` working in collapsed
   state so the home position is still settable; persist `dockPosition` as today.
4. Do not change the state machine, dwell, or transition logic — only the visual binding to
   `data-state`.

## Verification

- `bun test test/content/rail-state.test.ts` passes (Green).
- `bun run typecheck` and `bun run lint` pass.
