# Design — Calm Control

The single visual system for every XBlocker surface: the injected content UI
(reply rail, cursor console, toast, whitelist modal) and the extension popup.
Canonical tokens live in code (`entrypoints/lib/design-tokens.ts`); this file
documents them. If they disagree, the code is right — regenerate this file.

## Theme

Dual-theme, OKLCH throughout. The content UI resolves theme from X's own
background (`data-xb-theme="dark" | "light"` on `.xb-root`); the popup follows
`prefers-color-scheme`. Restrained color strategy: tinted cool neutrals plus
one accent per action tone, never decorative color.

## Color

### Action tones (theme-invariant)

| Token | Value | Use |
| --- | --- | --- |
| `--xb-primary` | `oklch(0.63 0.16 246)` | Primary actions, selection, focus rings |
| `--xb-danger` | `oklch(0.601 0.212 21)` | Block actions, errors |
| `--xb-success` | `oklch(0.646 0.152 154)` | Whitelist, confirmations |
| `--xb-warning` | `oklch(0.778 0.158 74)` | Mute actions, cautions |

Tone tints for hover washes: the tone color at `/ 0.12` alpha.

### Dark theme

| Token | Value |
| --- | --- |
| `--xb-surface` | `oklch(0.2 0.022 259)` |
| `--xb-elevated` | `oklch(0.27 0.025 255)` |
| `--xb-ink` | `oklch(0.97 0.006 255)` |
| `--xb-ink-muted` | `oklch(0.72 0.02 255)` |
| `--xb-border` | `oklch(1 0 0 / 0.12)` |
| `--xb-track` | `oklch(1 0 0 / 0.14)` |
| `--xb-hero-bg` | `oklch(0.98 0 0)` |
| `--xb-hero-ink` | `oklch(0.2 0.02 259)` |
| `--xb-shadow` | `0 8px 24px oklch(0 0 0 / 0.5), 0 0 0 0.5px oklch(1 0 0 / 0.06)` |

### Light theme

| Token | Value |
| --- | --- |
| `--xb-surface` | `oklch(1 0 0)` |
| `--xb-elevated` | `oklch(0.984 0.003 248)` |
| `--xb-ink` | `oklch(0.24 0.023 251)` |
| `--xb-ink-muted` | `oklch(0.5 0.02 251)` |
| `--xb-border` | `oklch(0.906 0.015 251)` |
| `--xb-track` | `oklch(0.24 0.023 251 / 0.08)` |
| `--xb-hero-bg` | `oklch(0.2 0.02 251)` |
| `--xb-hero-ink` | `oklch(1 0 0)` |
| `--xb-shadow` | `0 6px 20px oklch(0 0 0 / 0.12), 0 0 0 0.5px oklch(0 0 0 / 0.06)` |

"Hero" is the one inverted surface per screen (the primary bulk action):
near-black on light theme, near-white on dark.

## Typography

One family: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
Helvetica, Arial, sans-serif` with `-webkit-font-smoothing: antialiased`.
Fixed rem/px scale, tight product ratio:

| Role | Size / weight |
| --- | --- |
| Screen title | 15–16 px / 700 |
| Section heading | 13 px / 650 |
| Control label, body | 13 px / 500–600 |
| Description, status | 11–12 px / 500, `--xb-ink-muted` |
| Count badge | 10–12 px / 600–700, `tabular-nums` |

All live counters and stat values use `font-variant-numeric: tabular-nums`.

## Shape & Depth

- Radii: 16 px cards/modals, 10 px buttons/inputs, 8 px small controls,
  999 px pucks/pills. Nested elements stay concentric: inner ≈ outer − padding.
- Depth via layered shadow (`--xb-shadow`) plus a 1 px `--xb-border`; the
  shadow includes a 0.5 px spread ring so surfaces read on any background.
- Hit areas ≥40×40 px: controls under 40 px extend with an `::after { inset: -3px }`.

## Motion

| Token | Value |
| --- | --- |
| `--xb-ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--xb-ease-icon` | `cubic-bezier(0.2, 0, 0, 1)` |

- Durations: 150 ms color/background, 160 ms press, 200 ms icon cross-fade and
  enter, exits faster than enters (150 ms). Nothing above 250 ms.
- Press feedback: `transform: scale(0.96)` (0.98 for full-width rows).
- Icon state swaps cross-fade stacked slots: opacity 0↔1, scale 0.25↔1,
  blur 4px↔0 — never node swapping.
- Enter: opacity + small translate/scale from ≥0.95. Never `scale(0)`.
- Only `transform`, `opacity`, `filter` animate; properties always explicit,
  never `transition: all`.
- `prefers-reduced-motion`: transitions collapse to 120 ms opacity fades.

## Components

- **Buttons**: icon (34 px, radius 10), labeled (38 px row, hero/secondary
  variants, trailing tabular count pill), text/link (muted → ink on hover).
- **Switch**: 42×24 px pill, thumb 16 px, checked = `--xb-primary`,
  focus-visible ring, 160 ms ease.
- **Cards/sections**: `--xb-elevated` on popup, `--xb-surface` for injected
  floating surfaces; 1 px border + shadow.
- **Toast**: top-right, dot-tinted by type, enter translateY(-8px)→0.
- **Modal**: centered (`transform-origin: center`), backdrop
  `oklch(0 0 0 / 0.4)` + 8 px blur, panel scale 0.96→1.
- **States**: every control ships default / hover (pointer-gated) /
  focus-visible / active / disabled / busy / success / error.

## Voice

Labels are verb + object ("Add handle", "Sync now", "Block all"). Status lines
are short declaratives ("Backup on · synced 4m ago."). No exclamation marks,
no jargon, no em dashes.

## Gauge & Ledger (popup + settings surfaces)

The toolbar surfaces follow the "Gauge & Ledger" direction (spec:
`docs/plans/2026-07-10-gauge-and-ledger/plan.md`; chosen 2026-07-10 by a
3-concept, 3-judge panel, unanimous).

- **Type scale, locked**: 11 / 12 / 13 / 15 / 20 / 26 px; weights
  500 / 600 / 700 only. Both surfaces, verbatim.
- **Popup = gauge cluster**: 360px strip; no entrance animation ever; stat
  numbers 26/700 tabular-nums with 20×2px tone ticks (danger/warning/success)
  and uppercase 10px labels; counts animate (180ms count-up) only on real
  deltas via `lib/live-number.ts`, never on mount.
- **Telltale sync dot**: state = color AND temporal signature — solid success
  (synced) / 900ms breathing primary (syncing) / double-blink-then-hold danger
  (error) / hollow muted ring (off). Colorblind-safe by motion, readable
  peripherally.
- **No dead controls**: unavailable actions render as explanation or the
  available alternative ("Turn on in settings" link, "Not configured" text,
  explained-disabled cloud pane), never as inert live-looking buttons.
- **Reserved widths**: in-place label swaps ("Sync now" ↔ "Syncing…") and the
  log's relative-time column reserve their widest state; neighbors never
  reflow.
- **Settings = ledger**: 232px rail + content pane (640px forms / 960px
  tables); exactly two table row heights — whitelist 40px, blocked log 36px
  (virtualized, fixed-height windowing); tone colors on dots only, data labels
  stay ink.
- **Danger gradient**: routine destructive actions get inline "Confirm?"
  label-swaps (when the confirm setting is on); the cloud wipe alone gets a
  typed-WIPE gate (trimmed, case-insensitive compare), unconditional.
