# Cursor Console — XBlocker in-page UI redesign

Date: 2026-06-12
Status: SUPERSEDED by `2026-06-12-reply-rail-design.md` — the per-author cursor console
proved unclickable while following (it sits at a fixed offset from the cursor by
construction) and is replaced by a bulk-only, Y-tracking reply rail.
Original status: Approved direction from user ("console cannot be fixed, should appear around the cursor when the cursor is inside the reply"), grounded in the Stitch project **XBlocker Chrome UI Polish** (`projects/376932020779293096`, design system "Calm Control").

## Problem

The current in-page surface is a fixed bottom-right toolbar (status chip + three labeled buttons + settings + progress bar). It is far from the content it acts on, covers the page corner permanently, and offers only batch actions. The user wants the console to be contextual: it should appear near the cursor while the cursor is inside a reply, and the page-level surface must not be a big fixed bar.

## Approaches considered

1. **Cursor-following console (chosen).** One reusable floating pill of icon actions that materializes when the cursor dwells inside a reply article and trails the cursor with damped motion. Batch actions move to a separate compact, draggable rail. Pros: exactly the requested interaction, acts on the reply under the pointer, calm. Cons: most motion logic; needs careful suppression rules.
2. **Per-reply edge-anchored bar.** Console docks statically to the hovered reply's corner. Pros: simple, stable. Cons: not "around the cursor"; jumpy between replies. Used only as the reduced-motion fallback (snap instead of trail).
3. **Radial menu on long-hover.** Very novel, but poor discoverability and conflicts with text selection/native X gestures. Rejected.

## Design

Two surfaces, both unfixed:

### 1. Cursor Console (`data-xb-surface="cursor-console"`)
- Appears when the cursor enters a reply `article[data-testid="tweet"]` (on tweet detail pages the first article is the main tweet and is excluded).
- A compact horizontal pill: `@username` chip + icon buttons Block / Mute / Whitelist, 32px hit targets, icon-only with `aria-label` + `title` (Stitch: "high density, no labels").
- Follows the cursor at offset (+12, +16) with a rAF lerp (factor 0.18, `transform: translate3d`, `will-change: transform`). Under `prefers-reduced-motion: reduce` it snaps (no trailing, opacity-only entry).
- Viewport-aware: flips left of the cursor near the right edge, above the cursor near the bottom edge, clamped with an 8px margin (pure function `computeConsolePosition` for unit tests).
- Leaving the reply (or console) starts a 280ms grace timer before fade-out; re-entering (incl. hovering the console itself — hover bridge) cancels it. Escape hides immediately. Hidden while an `[aria-modal="true"]` dialog is open, while the cursor is in an input/textarea/contenteditable, and during a batch run.
- Whitelisted authors: whitelist button shows active (filled) state; block/mute act normally but show a warning toast first? No — keep simple: blocked actions on whitelisted users show "is whitelisted" toast and do nothing (matches batch skip semantics).
- After a successful block: the article gets a `data-xb-blocked` veil (opacity 0.45 + small "Blocked @user" chip), the dock counter increments.

### 2. Dock (`data-xb-surface="reply-action-bar"`)
- The Stitch "X Feed Overlay" rail: 48px-wide vertical, dark elevated surface, 12px radius — drag handle, batch Block replies, batch Mute replies, Whitelist modal, circular progress ring with the blocked count, Settings.
- Draggable via the handle; position persisted in `chrome.storage.local` (`dockPosition`); defaults to right edge, upper third. Never covers the cursor console (separate z-index bands).
- During batch runs the ring animates stroke-dashoffset as progress; the count updates live.

### Tokens (OKLCH, from the Stitch engineering board + converted hexes)
Injected once as CSS custom properties on a host attribute `[data-xb-theme="dark"|"light"]`:
- primary `oklch(63% 0.16 246)` (#0A8FE3 brand), danger `oklch(60.1% 0.212 21)`, success `oklch(64.6% 0.152 154)`, warning `oklch(77.8% 0.158 74)`
- dark: surface `oklch(24% 0.023 251)`, elevated `oklch(28.4% 0.025 249)`, ink `oklch(96.2% 0.009 248)`, border `oklch(96.2% 0.009 248 / 0.14)`
- light: surface `oklch(98.4% 0.003 248)`, elevated `oklch(100% 0 0)`, ink `oklch(24% 0.023 251)`, border `oklch(90.6% 0.015 251)`
- Hover tints use `oklch(... / 0.12)` alpha variants of the semantic colors. Pressed: `scale(0.97)` 120ms. All transitions 150ms ease-out. Global reduced-motion override per engineering board.

### Architecture
```
entrypoints/content/
  index.ts     entrypoint wiring, URL watcher, init, test hooks
  actions.ts   username extraction, direct block API, mute automation, whitelist storage
  console.ts   CursorConsole: show/hide/follow/render, suppression rules
  dock.ts      Dock rail: batch actions, progress ring, drag + persistence
  position.ts  pure geometry (computeConsolePosition, lerp)
  styles.ts    token sheet + classes + keyframes (OKLCH)
  theme.ts     detectTheme + observer (sets data-xb-theme)
  toast.ts     toasts
```
`entrypoints/content.ts` is replaced by `entrypoints/content/index.ts` (same WXT entrypoint name). All existing test-hook names are preserved; new hooks added for console/dock/position. Tests update their import path.

### Testing (bun test + happy-dom)
- `position.test.js`: pure geometry — offsets, right/bottom flip, clamping.
- `cursor-console.test.js`: appears on reply hover with correct @username; excluded on the main tweet; grace-period + hover bridge; Escape; suppression in inputs/modals; whitelisted state; block action veils the article and increments count. Deterministic motion via a `stepFollow()` test hook (no real rAF waits).
- `reply-action-bar.test.js`: rewritten for the dock — renders rail with aria-labels, progress ring, drag persistence.
- `direct-block.test.js`: unchanged except import path.
- Gate: `bun run check` (tsgo typecheck, oxlint type-aware, oxfmt check, bun test, wxt build) fully green.

### Out of scope (tracked in todo.md)
Keyboard j/k mode, hidden-post reveal/undo, not-interested automation, advanced settings popup.
