# Migration spec — xblocker (MV3 extension)

Migration of xblocker options and popup UI surfaces to StyleX with exact computed-style and rendering parity.

## 1. Stack

| Fact | Value |
|---|---|
| UI framework | Vanilla TypeScript / DOM (`document.createElement`), native DOM nodes and attributes |
| StyleX call | `stylex.props()` / `stylex.attrs()` for compiled class strings applied via `el.className` and `el.style` |
| Class prop today | `className` on created HTML elements |
| Style-forwarding prop after migration | Direct StyleX style objects or `stylex.props()` classes applied to elements |
| Bundler / meta-framework | WXT `^0.20.26` wrapping Vite 8.0.x |
| StyleX wiring (from INTEGRATION.md) | `@stylexjs/unplugin/vite` attached to HTML entrypoints (`options`, `popup`) via WXT build hooks |
| Build that renders the UI | HTML entrypoints (`entrypoints/options/index.html`, `entrypoints/popup/index.html`) |
| Sibling builds that stay byte-identical | Background service worker (`background.ts`), content scripts (`entrypoints/content/*`) |
| Rendering | CSR in extension pages (`options.html` full tab, `popup.html` browser action bubble) |
| Browser floor | Chrome MV3 (`chrome >= 120`) |
| Styling today | Raw CSS template strings injected via `<style>` tags (`entrypoints/options/styles.ts`, `entrypoints/popup/main.ts`) referencing design tokens in `entrypoints/lib/design-tokens.ts` |
| Dark mode | `@media (prefers-color-scheme: dark)` OS level |
| Component library | None (bespoke Calm Control design system with custom controls: switches, buttons, virtual list, chips) |
| State attribute vocabulary | `data-variant="primary|secondary|ghost"`, `data-tone="danger|warning"`, `data-sync="synced|pending|error"`, `data-route`, `aria-current="page"`, `aria-pressed`, `aria-label`, `role="row|group|nav"` |
| Class-merge / variant helpers | None |
| Animation helpers | None (custom CSS transitions with `--xb-ease-out`, `--xb-ease-icon`) |
| Icons / leaf components | `entrypoints/lib/icons.ts` SVG icon creator (`createIcon(name, size)`) |

## 2. Gate (exact commands)

| Step | Command |
|---|---|
| format | `bun run format:check` |
| lint | `bun run lint` (`oxlint --type-aware --deny-warnings .`) |
| boundary lint | `bun run lint:boundaries` (`depcruise entrypoints packages convex`) |
| typecheck | `bun run typecheck` (`tsgo --noEmit`) |
| unit tests | `bun run test` (`bun test`) |
| build | `bun run build` (`wxt build`) |
| full gate | `bun run check` |

## 3. Global CSS

Document-level root rules in `entrypoints/options/styles.ts` and `entrypoints/popup/main.ts`:
- `color-scheme: light dark;`
- `html, body { height: 100%; margin: 0; }`
- `body`: font-family `${XB_FONT_STACK}`, `-webkit-font-smoothing: antialiased;`
- Popup fixed width: `body { width: 360px; }`
- Motion reduction: `@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; } }`

## 4. Merge-helper conflict rules in force

None — classes are assigned directly or conditionally via ternary expressions.

## 5. Parent → child rules and where they went

- Popup region dividers: `.xb-region + .xb-region, .xb-header + .xb-popup-main > .xb-region:first-child { border-top: 1px solid var(--xb-border); }`
- Active nav item indicator: `.xb-opt-nav-item[aria-current="page"]::before { content: ""; position: absolute; left: -8px; top: 4px; bottom: 4px; width: 2px; border-radius: 2px; background: var(--xb-primary); }`

## 6. Descendant markers

Not required for vanilla DOM; element styles map directly to StyleX style rules.

## 7. Dropped rules

None.

## 8. Tokens

Defined in `entrypoints/lib/tokens.stylex.ts` using `stylex.defineVars`:
- Color tokens (`--xb-primary`, `--xb-primary-btn-bg`, `--xb-danger`, `--xb-success`, `--xb-warning`, `--xb-surface`, `--xb-elevated`, `--xb-ink`, `--xb-ink-muted`, `--xb-primary-text`, `--xb-border`, `--xb-track`, `--xb-hero-bg`, `--xb-hero-ink`, `--xb-shadow`)
- Easing and typography tokens (`--xb-ease-out`, `--xb-ease-icon`, `--xb-font-stack`)
- Dark mode values declared via `@media (prefers-color-scheme: dark)` keys in `tokens.stylex.ts`.

## 9. Component API

Components import compiled StyleX style objects and apply class strings directly using `stylex.props(styles.xyz).className` or a helper `cls(styles.xyz)`.

## 10. Parity hosts and scenarios

Extension options and popup pages loaded via Chrome extension build or headless server.

## 11. File groups

| Group | Files | Notes |
|---|---|---|
| Tokens & Infrastructure | `entrypoints/lib/tokens.stylex.ts`, `wxt.config.ts` | StyleX plugin and token definitions |
| Options Shell | `entrypoints/options/main.ts`, `entrypoints/options/styles.ts` | Brand, sidebar rail, navigation, version |
| Options Panes Form | `entrypoints/options/panes/general.ts`, `entrypoints/options/panes/cloud.ts`, `entrypoints/options/panes/about.ts` | Switch rows, sliders, metadata rows |
| Options Panes Table | `entrypoints/options/panes/blocked-log.ts`, `entrypoints/options/panes/whitelist.ts`, `entrypoints/options/virtual-list.ts` | Toolbar, search input, chips, tables |
| Popup Surface | `entrypoints/popup/main.ts` | Header, stat strip, toggles, sync row, footer |
