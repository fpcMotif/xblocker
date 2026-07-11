# Gauge & Ledger — popup + settings redesign

Winning direction from a 3-concept, 3-judge design panel (unanimous, 44/50 vs 40
and 31). Thesis: a tool opened dozens of times a day earns trust through
mechanical precision, not personality. The popup is a gauge cluster; the
settings page is a ledger. Tokens are the existing Calm Control system in
`entrypoints/lib/design-tokens.ts` (see DESIGN.md). User-locked IA: lean popup,
two-pane settings (General · Whitelist · Blocked log · Cloud backup · About)
with blocked-accounts log, whitelist import/export, and a cloud danger zone.

## Shared rules (both surfaces)

- **One type scale, verbatim everywhere**: 11 / 12 / 13 / 15 / 20 / 26 px.
  Weights 500 / 600 / 700 only. All changing numbers `tabular-nums`.
- **Radii by formula**: card 16 → inner control 10 → inner chip 8 (concentric).
- **States**: every control ships default / hover (pointer-gated) /
  focus-visible (2px `--xb-primary` outline, offset 2) / active (scale 0.96;
  0.98 full-width rows) / disabled (opacity 0.45) / busy where async.
- **No dead controls, ever.** When an action is unavailable, either explain it
  in place (muted text, explained-disabled card) or swap in the affordance that
  IS available (e.g. "Turn on in settings" link instead of a disabled button).
- **Reserved widths**: any element whose label swaps in place ("Sync now" ↔
  "Syncing…") reserves the width of its longest state so neighbors never
  reflow. Same for the log's "When" column (fixed numeral slot, '59m'→'1h').
- **One count-change primitive**: a single shared helper animates numeric
  text changes (180ms ease-out count-up, fires only on a REAL delta — diffed
  and 100ms-debounced from `chrome.storage.onChanged` — never on
  mount/reopen; reduced-motion: snap + 120ms opacity flash). Used by popup
  stats and the log footer count. Suggested home: `entrypoints/lib/live-number.ts`.
- **Tone discipline**: tone colors mark state only (dots, ticks, danger
  actions). Data-label text stays `--xb-ink` (e.g. the log's Block/Mute
  labels are ink; only the 3px dot beside them is danger/warning).
- Motion: 150–250ms, `--xb-ease-out`; popup has NO entrance animation;
  `prefers-reduced-motion` collapses to opacity fades.

## Popup (reshape `entrypoints/popup/main.ts` to a lean strip)

360px wide, ~356px tall, no scroll, background `--xb-surface` (no nested
panel). Padding 16px sides / 14px vertical. Full-width 1px `--xb-border`
dividers between regions.

1. **Header** 44px: brand chip 22×22 (radius 8, primary/0.12 bg, primary
   shield icon) + "XBlocker" 15/700; right: status — 6px dot (solid
   `--xb-success` = active; hollow muted ring = inactive) + 12/600 muted
   "On x.com" / "Off x.com".
2. **Stat strip** 64px: grid 1fr×3, 1px `--xb-border` internal hairlines
   (gauge-cluster). Per cell: number 26/700 tabular-nums; a 20×2px tone tick
   under it (danger=Blocked, warning=Muted, success=Whitelisted); label
   10/600 uppercase tracked 0.06em muted ("Blocked" / "Muted" /
   "Whitelisted"). Live-updates via the shared count primitive.
3. **Toggles** 2×44px rows: "Protect whitelist" — caption "Whitelisted
   handles are skipped during bulk actions."; "Confirm destructive actions" —
   caption "Ask before block or mute runs." Label 13/600, caption 11/500
   muted. Switch 42×24 (track `--xb-track`/checked `--xb-primary`, 16px
   thumb, 160ms).
4. **Sync row** 48px: left — 8px telltale dot + two-line stack (12/600 ink +
   11/500 muted). Telltale states with temporal signatures (colorblind-safe):
   solid success = synced; 900ms breathing opacity 1↔0.4 primary = syncing
   (reduced-motion: static 0.7); double-blink-then-hold danger = error;
   hollow muted ring = off. Copy: "Backup on"+"Synced 4m ago." / "Backup
   on"+"Syncing…" / "Backup on"+"Sync failed. Tap retry." / "Backup
   off"+"Turn on in settings." Right — when backup ON: "Sync now" secondary
   button 30px (reserved width, busy spinner cross-fade, existing status
   strings preserved for the engine layer); when OFF: a ghost text-link
   "Turn on in settings" (opens options); when unconfigured (no
   VITE_CONVEX_URL): plain muted text "Not configured". No dead buttons.
5. **Footer** (8px air, no rule): full-width 40px row-button, transparent →
   `--xb-elevated` hover, active 0.98; "Open settings" 13/600 left, chevron
   muted right → `chrome.runtime.openOptionsPage()` (guarded optional call
   for the test chrome mock).

No hero surface in the popup — the hero token stays reserved for the Reply
Rail's primary action.

Removed from popup (move to settings): whitelist section, Max replies, cloud
card. Popup keeps only what's listed above.

## Settings page (new `entrypoints/options/`)

Full-tab options page (`open_in_tab: true`). Two-pane: fixed left rail 232px
(`--xb-elevated`, 1px right border) + fluid scrollable content
(`--xb-surface`, 40px padding). File layout suggestion:
`entrypoints/options/index.html`, `main.ts` (shell + router), `styles.ts`,
`panes/{general,whitelist,blocked-log,cloud,about}.ts`,
`virtual-list.ts` — all under the 100% coverage gate.

- **Rail**: brand row 56px (chip + "XBlocker" 15/700); nav items 40px
  (18px icon + 13/600 label, muted → ink when active; active bg
  primary/0.12 + 2px inset left bar primary; hover `--xb-track`); pinned
  bottom: manifest version 11/500 tabular-nums muted (via
  `chrome.runtime.getManifest?.()`).
- Pane header pattern: H1 20/700 + one-line 13/500 muted description, 24px
  below. Form panes constrain to 640px column; table panes to 960px.

### General
Bordered group card (radius 16, `--xb-elevated`), 56px rows with internal
hairlines: Protect whitelist · Confirm destructive actions · Keyboard mode
(caption "Reserved for upcoming j/k navigation in the reply rail." — stored,
honestly captioned). Separate group: "Max replies per run" (caption "Cap on
accounts processed per bulk action, 1–200.") — 220px slider paired with a
linked 56px tabular numeric input, both writing the same
`clampMaxReplies()` value, always in lockstep.

### Whitelist
Toolbar: `@handle` input + primary "Add" (36px). Invalid → input border
danger + caption "Not a valid handle." (no shake). Search input (debounced
120ms). Table 960px, **row height 40px** (one of exactly two table row
heights in the surface), flat, hover `--xb-track`: Handle · Added · remove.
Remove = 28px ghost icon button, opacity 0 → 1 on row hover/focus-within
(tab-reachable always); with "Confirm destructive actions" on, first click
swaps label to "Confirm?" for ~3s before executing. Top-right: "Import
JSON" / "Export JSON" secondary buttons. Import is shape-validating with a
concrete inline result: "Imported 12, skipped 3 duplicates." / "That file
isn't a whitelist export." Empty state: "No whitelisted handles yet." +
"Add a handle above to exclude it from bulk block and mute runs." Backed by
`lib/whitelist-store` only.

### Blocked log
Wires the store's until-now-unused `list()`. Toolbar: search + filter chips
(All / Block / Mute) + sync chips (All / Synced / Pending / Local) + "Export
JSON". Table 960px, **row height 36px**, virtualized (fixed-height
windowing, viewport÷36 + 10 overscan; only this table virtualizes; must be
exercised at 0 / 5 / 2000 rows in tests): Handle · Action (ink label + 3px
tone dot) · When (relative, absolute in `title`, fixed numeral slot) · Sync
(dot + Synced/Pending/Local). Roving tabindex; ↑/↓ and j/k move row focus.
Footer: singular-aware tabular count ("1 account" / "2,000 accounts") using
the shared count primitive. Past ~800px scroll: 36px ghost jump-to-top.
Empty: "No blocked accounts yet." + "Bulk actions from the reply rail will
populate this log."

### Cloud backup
Status card (radius 16): title + "Mirror your blocked list to your private
Convex project." + switch; meta rows 44px: Status (telltale) · Last synced ·
Pending actions (outbox count). "Sync now" 36px secondary (reserved width).
**Unconfigured build (no VITE_CONVEX_URL): the entire pane renders one
explained-disabled state — "Cloud backup isn't configured for this build." —
no live-looking controls.** Danger zone: separate card, 1px
`--xb-danger`/0.35 border (stroke only), heading "Danger zone" 13/600
danger; body "Permanently delete every account this owner has synced to the
cloud. This cannot be undone and does not touch your local block/mute
list."; "Wipe cloud data" (danger-filled) expands the card in place (200ms
height+opacity) revealing input "Type WIPE to confirm" (compare trimmed,
case-insensitive; display literal WIPE) + Cancel + "Confirm wipe" (disabled
until match). Executes a new `wipeCloud()` in `lib/sync-engine.ts` that
calls the existing (currently unwired) `clearOwner` mutation in
`lib/convex-sync.ts`, then resets meta. This gate is unconditional —
independent of the "Confirm destructive actions" toggle (blast radius is
categorically larger).

### About
32px mark · "Version {manifest}" 13 tabular muted · "Local-first reply-spam
blocking for X, with optional private cloud backup." · GitHub link row
(repo URL from package.json) · "Data stays on this device unless cloud
backup is turned on."

## Engineering notes

- WXT: `entrypoints/options/index.html` is the options entrypoint; set
  `open_in_tab: true` (WXT manifest meta or wxt.config manifest override —
  verify against WXT 0.20 docs). Popup's openOptionsPage needs
  `options_ui` present to work.
- Preserve the sync-engine status strings currently asserted in
  test/popup/cloud-backup.test.ts, or update those tests deliberately.
- happy-dom: file import/export via hidden `<input type=file>` and anchor
  download — factor through small seams so tests can stub File/Blob/URL.
- 100% coverage on every new `entrypoints/**` file; full `bun test` is the
  only truthful run. `bun run check` must pass end to end.
