# XBlocker

XBlocker is a browser-extension context for acting on unwanted X.com reply content quickly while preserving trusted accounts.

## Surfaces

XBlocker has **two distinct in-page surfaces that coexist** on a status/tweet page and share the same direct session-authenticated block/mute API; neither replaces the other:

- the **Reply Rail** acts on *all* replies at once (**bulk**);
- the **Cursor Console** acts on *one* reply's author (**single**).

## Language

**Reply Rail** (formerly _Reply Action Bar_ / the _Dock_):
The bulk surface — a draggable vertical rail of labeled actions for page-level operations (block/mute *all* replies, whitelist, settings). It tracks the cursor's height in the reply region and collapses to a quiet puck at rest; batch progress is shown on the triggering button (no standalone ring). Core actions are visible directly rather than hidden behind an overflow menu, and it is never fixed to a screen corner — the user can move it. Mounted only on status/tweet pages.
_Avoid_: Dashboard, floating menu, three-dot menu

**Cursor Console**:
The single-reply surface — a per-reply control revealed while the cursor is over a reply article. It targets that reply's author (block/mute/whitelist that one user) in one click with no confirmation, reusing the same direct session-authenticated API as the bulk Reply Rail. Anchored to the reply's top-right corner and surfaced on hover; not shown on the main tweet. **Coexists with the Reply Rail** (single vs bulk). Strategy is flagged via `VITE_QUICK_BLOCK_MODE` (see docs/adr/0001-one-click-manual-block.md).
_Avoid_: Tooltip, context menu, popup

**Whitelist**:
The set of trusted X.com usernames that XBlocker should not block or mute.
_Avoid_: Allowlist, safe list

## Design source of truth

Stitch project **XBlocker Chrome UI Polish** (`projects/376932020779293096`), design system **Calm Control**: Inter, primary #0A8FE3, OKLCH tokens (see `entrypoints/content/styles.ts`), dual light/dark, compact density, tonal layers over heavy shadows.
