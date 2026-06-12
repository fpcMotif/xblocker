# Reply Rail — bulk-action console that tracks the cursor

Date: 2026-06-12
Status: Design approved. Supersedes `2026-06-12-cursor-console-design.md` (the per-author
cursor console is removed; this rail is the only in-page surface).
Open item: motion personality (Glide / Spring / Magnetic rows) — to be chosen via the
playable prototype before implementation.

## Problem

The cursor-following per-author console is unclickable by construction: it is positioned
at a fixed offset from the cursor, so moving toward it moves it away. The user's real
goal is **bulk** block/mute of reply accounts, which needs a stable, clickable control
surface — but a permanently fixed bar is far from where the user is reading.

## Decisions (from brainstorm)

- **Bulk-only.** The console carries batch actions (`blockReplies` / `muteReplies`)
  only. No per-author block/mute/whitelist buttons; `CursorConsole` is deleted.
- **One surface.** The existing dock and the cursor console merge into a single
  draggable rail ("Reply Rail"). It keeps the dock's buttons and persistence.
- **Right side, sidebar-like** (user picked option B over a left-gutter rail).
- **Dual move:** in reply mode the rail's Y tracks the cursor height (damped); X stays
  at the docked home position, so the rail is always one horizontal flick away.
- **Freeze rule: dwell + leave-column.** The rail settles (stops tracking) when any of:
  cursor pauses >1s inside the replies; cursor exits the reply column (e.g. heading to
  the rail); cursor hovers the rail. Moving inside the replies again resumes tracking.
- **Idle state: collapse to a small handle** at the home position when the cursor is
  not in the reply region.

## States

| State | Appearance | Entered by |
|-----------|---------------------------------------|------------|
| Collapsed | small round handle, session count badge, home position | page load; cursor out of both replies and rail for ≈600ms; Escape |
| Tracking | expanded vertical rail, Y glides with cursor | cursor enters reply region |
| Settled | frozen; lock cue (brighter border + pin dot) | dwell >1s; cursor exits reply column; cursor over rail |

Batch running: rail stays settled, progress ring animates, tracking suspended until the
batch completes.

## Rail anatomy (expanded, top → bottom)

1. Drag handle (sets home X/Y, persisted as `dockPosition` in `chrome.storage.local`)
2. Bulk block all replies — with a count of currently loaded replies (≤ `maxReplies`)
3. Bulk mute all replies — same count
4. Whitelist modal
5. Progress ring + session blocked count
6. Settings

Collapsed handle: ~36px circle showing the session blocked count; draggable; expands on
reply-mode entry.

## Motion

- rAF loop + `lerp`, Y axis only, clamped to viewport with 8px margins (pure function
  `computeRailY(cursorY, railHeight, viewport)` for unit tests).
- Dwell detection: no cursor movement beyond a ~4px jitter threshold for 1000ms.
- `prefers-reduced-motion: reduce`: no glide — snap positioning; expand/collapse is
  opacity-only.
- Personality variants (prototype will decide):
  - (a) **Glide** — damped lerp (like the old FOLLOW_FACTOR behavior)
  - (b) **Spring** — spring physics with slight overshoot
  - (c) **Magnetic rows** — rail aligns to the vertical center of the hovered reply
    row, stepping reply-to-reply like a focus indicator

## Reply-mode detection & suppression

- Reply mode = cursor inside the union rect of reply `article[data-testid="tweet"]`
  elements; the main tweet is excluded via existing `isReplyArticle`.
- Suppressed (collapses) while an `[aria-modal="true"]` dialog is open or while the
  cursor is in an input/textarea/contenteditable.
- Escape collapses immediately. Scroll keeps the current state but re-clamps Y.

## Architecture

```
entrypoints/content/
  index.ts     wiring: rail only; cursor-console wiring removed
  rail.ts      ReplyRail (evolved dock.ts): states, tracking, dwell, drag, batch, ring
  position.ts  pure Y-geometry: computeRailY, lerp, clamp
  console.ts   DELETED
```

Test hooks: `getRail()` replaces `getDock()`/`getCursorConsole()`; a deterministic
`step()` advances the motion loop without real rAF waits; dwell timer driven by fake
timers.

## Testing (bun test + happy-dom, 100% coverage gate)

- `position.test.ts`: `computeRailY` clamping, lerp, jitter threshold.
- `rail.test.ts` (replaces `cursor-console.test.ts` + `dock.test.ts`): state
  transitions per the table above; freeze triggers (dwell / leave-column / hover);
  resume on movement; collapse grace; Escape; suppression; drag persistence; batch
  progress ring; reply counts on bulk buttons; reduced-motion snap.
- Gate: `bun run check` (tsgo, oxlint, oxfmt, bun test, wxt build) fully green.

## Out of scope

Keyboard j/k mode, per-author actions (removed deliberately), hidden-post reveal/undo,
left-gutter/adaptive placement (rejected option A).
