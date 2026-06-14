# Reply Rail — visual redesign (labeled vertical rail)

Date: 2026-06-14
Status: Design approved (direction + accent chosen in brainstorm).
Augments `2026-06-12-reply-rail-design.md`. **All functional behavior from that spec is
preserved unchanged** — states (collapsed/tracking/settled), Glide motion (lerp 0.22),
dwell 1000ms / jitter 4px / collapse grace 600ms, reply-region detection, drag
persistence, batch block/mute, status-page-only mounting. This spec changes only the
*visual skin, DOM structure, and count/progress presentation*. It is not a
re-architecture.

> **Scope:** this redesign reskins the **bulk Reply Rail** only. Single-reply
> (per-author) block/mute is a separate, **coexisting** surface — the **Cursor Console**
> ([ADR-0001](../../adr/0001-one-click-manual-block.md)) — which this redesign does not
> touch. See `CONTEXT.md` for the rail-vs-console (bulk-vs-single) split.

## Problem (what makes the current rail look bad)

The in-page rail (see `entrypoints/content/rail.ts`, `styles.ts`) is functionally sound
but reads as a foreign object bolted onto X:

1. **A column of zeros.** At rest the rail shows four meaningless `0`s — the drag-handle
   count, the block count badge, the mute count badge, and the session ring. The zeros
   are the dominant visual.
2. **A dark slab on a white page.** `--xb-surface` dark glass + a heavy three-layer
   shadow sits on top of X's light timeline. (Observed worse: the rail rendered *dark on
   a light X page* — a theme-detection misfire; see Theme fidelity below.)
3. **Mystery-meat icons.** Ban, speaker-x, shield, gear, grip — five unrelated metaphors
   stacked at identical 32px weight. Nothing communicates what the surface does.
4. **No primary action.** The two bulk actions (the entire reason the rail exists) carry
   the same visual weight as the settings gear.

## Decisions (from brainstorm)

- **Form: labeled vertical rail.** Keep the vertical, right-edge-docked rail (so
  cursor-Y tracking and out-of-the-way placement still make sense), but replace cryptic
  icons with plain-text labeled buttons and a clear hierarchy. (Chosen as "Blend A+B"
  over a wide horizontal card and over a hover-expand puck.)
- **Native X surface.** White surface in X light mode, dark surface in X dark mode,
  X hairline border, a single soft shadow (not the current three-layer stack). The rail
  should look like it shipped with X.
- **Black hero.** "Block all" is a solid black button (`#0f1419` light / X's primary
  language); "Mute all" is an outlined secondary button. Block is the decisive action and
  black both carries that weight and stays distinct from X's pervasive blue.
- **Kill the zeros.** Every count is hidden until it is non-zero. No standing `0`s.
- **One puck at rest.** Collapsed state is a single quiet circular puck (currently the
  collapsed state is tracked but not visually distinct); it expands to the labeled rail
  on reply-region entry.

## Anatomy

### Expanded (states: tracking / settled)

A vertical card, ~158px wide, white X surface, 16px radius, 0.5px X hairline border, one
soft shadow. Top → bottom:

1. **Header row** — small muted `Replies` label + grip handle (`drag` icon) on the right.
   The grip is the drag affordance (replaces the old handle-with-count). No count here.
2. **Block all** — black hero button: `ban` icon + `Block all` label + a count chip
   (loaded reply count, ≤ `maxReplies`). Chip hidden when count is 0.
3. **Mute all** — outlined secondary button: `volume` icon + `Mute all` label + count
   (same value, muted color). Count hidden when 0.
4. **Divider** — full-width hairline.
5. **Footer row** — left: two icon-only ghost buttons, `whitelist` (shield-**check**) and
   `settings` (gear). Right: **session indicator** — a distinct solid/half shield glyph
   (the app's identity mark, deliberately *not* the shield-check used for whitelist, so
   the two shields don't read as the same control) + session-blocked count, shown only
   when count > 0, `title="Blocked this session"`.

### Collapsed (state: collapsed — at rest)

A single ~46px circular puck (shield glyph) at the home position. A small count badge in
the top-right corner shows the session-blocked count, shown only when > 0. Draggable.
Expands to the full rail when the cursor enters the reply region (existing transition).

### Batch progress (replaces the standalone ring)

When a batch runs, progress is shown **on the triggering button** (co-located with the
action) rather than on a separate ring:

- The button label switches to a live `n / total` count.
- A thin determinate progress fill animates along the button's bottom edge, driven by
  `done / total` (replaces the old `strokeDashoffset` ring animation).
- On completion the footer session indicator increments (block only) and the existing
  toast fires. The standalone progress ring element is removed.

## Visual tokens

Reuse existing OKLCH tokens in `styles.ts` where possible; tune for the X-native look:

- **Surface**: light = `oklch(1 0 0)` opaque (drop the 0.92 alpha + heavy blur that made
  it read as glass); dark = current dark surface, opaque.
- **Border**: a single X-style hairline (`--xb-border`), 0.5px.
- **Shadow**: one soft shadow (`0 6px 20px oklch(0 0 0 / 0.10)`, plus a 0.5px hairline
  ring), replacing the three-layer `--xb-shadow`.
- **Hero**: black `oklch(0.18 0.02 251)` (light) bg, white label; chip = `white / 0.18`.
- **Secondary**: transparent bg, `--xb-border` outline, `--xb-ink` label, muted icon.
- **Counts**: `font-variant-numeric: tabular-nums`, weight 500.

## Code changes

```
entrypoints/content/
  rail.ts      Rebuild constructor DOM: header+grip, labeled block/mute, footer row,
               collapsed puck; route batch progress to the active button; hide counts
               at 0; keep all state-machine / motion / drag / batch logic intact.
  buttons.ts   Add a labeled variant: icon + text label + optional count chip, keeping
               the existing busy/success/error icon-swap state machine. (The footer
               whitelist/settings stay icon-only via the current path.)
  styles.ts    Replace dock/console visual rules with the rail skin above; add
               [data-state="collapsed"] puck styling and the on-button progress fill;
               drop the standalone .xb-ring rules.
  icons.ts     Reuse existing block/mute/whitelist(shield-check)/settings/drag; add a
               distinct solid/half shield glyph for the puck + footer session indicator.
  theme.ts     Tighten detectTheme so the rail matches X's actual mode (see below).
```

The cursor-tracking engine (`position.ts`, `step()`, dwell, follow loop, drag, batch
wiring in `index.ts`) is untouched.

## Theme fidelity

The rail must match X's current theme. The observed dark-on-light misfire suggests
`detectTheme()` over-triggers (e.g. an X `meta[theme-color]` or stray `[data-theme]`).
Scope: make detection reliable for X light/dim/dark, verified against the live page during
implementation; keep the existing `observeThemeChanges` re-sync. No new dependency.

## Accessibility

- Labeled buttons keep `aria-label` (now redundant with visible text, but harmless) and
  gain visible text — a net legibility win. `role="toolbar"` on the root stays.
- Collapsed puck: `aria-label="XBlocker — N blocked this session"`.
- Hidden-when-zero counts must also be hidden from the accessibility tree (not just
  visually) so screen readers don't announce stale/absent numbers.
- Focus-visible rings, reduced-motion fallbacks (opacity-only expand/collapse, snap
  positioning) carry over from current `styles.ts`.

## Testing (bun test + happy-dom, 100% coverage gate)

Existing suites assert DOM structure and counts, so they change with the DOM:

- `rail-state.test.ts` — collapsed↔tracking↔settled transitions unchanged; add: collapsed
  state renders the puck (single button) and hides the expanded body; expanded renders the
  labeled rail.
- `rail-actions.test.ts` — update selectors for labeled buttons; assert: count chips show
  the loaded-reply count and are hidden/removed at 0; session indicator hidden at 0 and
  shown after a successful block; batch progress drives the active button's fill + `n /
  total` label (replacing the ring assertions); whitelist/settings/drag still wired.
- `position.test.ts` — unchanged (pure geometry).
- New/updated: theme detection cases for X light vs dark.
- Gate: `bun run check` (tsgo, oxlint, oxfmt, bun test, wxt build) fully green, 100%
  coverage maintained.

## Out of scope

- Functional behavior changes (motion personality, dwell/grace timings, reply detection,
  status-page gating) — all preserved.
- Per-author single-reply actions — handled by the separate, coexisting **Cursor Console**
  surface ([ADR-0001](../../adr/0001-one-click-manual-block.md): an edge-anchored per-reply
  control, distinct from the deleted cursor-following console). This redesign reskins only
  the bulk Reply Rail and leaves the Cursor Console untouched — not "removed from the
  product".
- Keyboard j/k mode, hidden-post reveal/undo (out per the 2026-06-12 spec).
- Popup UI restyle (separate surface).
- Any new colors beyond the X-native palette above.
