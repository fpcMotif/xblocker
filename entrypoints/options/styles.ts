// Settings-page stylesheet. Unlike content/styles.ts (which reads x.com's own surface via
// content/theme.ts's detectTheme), this is a standalone extension tab with no host page to
// inspect, so it follows the OS preference directly: light tokens by default, dark tokens
// under a `prefers-color-scheme: dark` override, plus `color-scheme: light dark` so native
// form controls (scrollbars, range thumbs) pick a matching chrome.

import {
  XB_DARK_TOKENS,
  XB_FONT_STACK,
  XB_LIGHT_TOKENS,
  XB_TONE_TOKENS,
} from "../lib/design-tokens";

const STYLE_ID = "xblocker-options-styles";

const SHEET = `
:root { color-scheme: light dark; }
html, body { height: 100%; }
body {
	margin: 0;
	font-family: ${XB_FONT_STACK};
	-webkit-font-smoothing: antialiased;
}
.xb-opt-root, .xb-opt-root *, .xb-opt-root *::before, .xb-opt-root *::after {
	box-sizing: border-box;
}
.xb-opt-root {${XB_TONE_TOKENS}${XB_LIGHT_TOKENS}
	display: grid;
	grid-template-columns: 232px 1fr;
	min-height: 100vh;
	background: var(--xb-surface);
	color: var(--xb-ink);
}
@media (prefers-color-scheme: dark) {
	.xb-opt-root {${XB_DARK_TOKENS}}
}
@media (prefers-reduced-motion: reduce) {
	.xb-opt-root, .xb-opt-root * { transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; }
}

/* ---- Rail ---- */
.xb-opt-rail {
	position: sticky;
	top: 0;
	height: 100vh;
	display: flex;
	flex-direction: column;
	background: var(--xb-elevated);
	border-right: 1px solid var(--xb-border);
}
.xb-opt-brand {
	display: flex;
	align-items: center;
	gap: 10px;
	height: 56px;
	padding: 0 16px;
	flex: 0 0 auto;
}
.xb-opt-brand-mark {
	display: grid;
	place-items: center;
	width: 22px;
	height: 22px;
	border-radius: 8px;
	background: oklch(0.63 0.16 246 / 0.12);
	color: var(--xb-primary);
}
.xb-opt-brand-name {
	font-size: 15px;
	font-weight: 700;
	line-height: 1.2;
}
.xb-opt-nav {
	display: flex;
	flex-direction: column;
	padding: 4px 8px;
	gap: 2px;
}
.xb-opt-nav-item {
	position: relative;
	display: flex;
	align-items: center;
	gap: 10px;
	height: 40px;
	padding: 0 10px;
	border-radius: 10px;
	color: var(--xb-ink-muted);
	text-decoration: none;
	font-size: 13px;
	font-weight: 600;
	transition: background-color 150ms ease, color 150ms ease;
}
.xb-opt-nav-item svg { color: inherit; }
.xb-opt-nav-item[aria-current="page"] {
	background: oklch(0.63 0.16 246 / 0.12);
	color: var(--xb-primary);
}
.xb-opt-nav-item[aria-current="page"]::before {
	content: "";
	position: absolute;
	left: -8px;
	top: 4px;
	bottom: 4px;
	width: 2px;
	border-radius: 2px;
	background: var(--xb-primary);
}
@media (hover: hover) and (pointer: fine) {
	.xb-opt-nav-item:not([aria-current="page"]):hover { background: var(--xb-track); color: var(--xb-ink); }
}
.xb-opt-nav-item:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-opt-version {
	margin-top: auto;
	padding: 12px 16px 16px;
	font-size: 11px;
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	color: var(--xb-ink-muted);
}

/* ---- Content ---- */
.xb-opt-content {
	min-width: 0;
	padding: 40px;
}
.xb-opt-pane-header { margin-bottom: 24px; }
.xb-opt-pane-header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; line-height: 1.25; }
.xb-opt-pane-header p { margin: 0; font-size: 13px; font-weight: 500; color: var(--xb-ink-muted); }
.xb-opt-pane-form { max-width: 640px; }
.xb-opt-pane-table { max-width: 960px; }

/* ---- Cards / grouped rows ---- */
.xb-opt-card {
	border: 1px solid var(--xb-border);
	border-radius: 16px;
	background: var(--xb-elevated);
	overflow: hidden;
}
.xb-opt-card + .xb-opt-card { margin-top: 20px; }
.xb-opt-card-header { padding: 16px 20px 0; }
.xb-opt-card-header h2 { margin: 0 0 2px; font-size: 15px; font-weight: 700; }
.xb-opt-card-header p { margin: 0 0 12px; font-size: 12px; font-weight: 500; color: var(--xb-ink-muted); }
.xb-opt-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 56px;
	padding: 0 20px;
	border-bottom: 1px solid var(--xb-border);
}
.xb-opt-row:last-child { border-bottom: none; }
.xb-opt-row-meta { min-height: 44px; }
.xb-opt-row-copy { display: grid; gap: 2px; min-width: 0; }
.xb-opt-row-title { font-size: 13px; font-weight: 600; }
.xb-opt-row-caption { font-size: 11px; font-weight: 500; color: var(--xb-ink-muted); }
.xb-opt-row-value { font-size: 12px; font-weight: 600; color: var(--xb-ink); white-space: nowrap; }

/* ---- Switch ---- */
.xb-opt-switch {
	appearance: none;
	position: relative;
	flex: 0 0 auto;
	width: 42px;
	height: 24px;
	margin: 0;
	border-radius: 999px;
	border: 1px solid var(--xb-border);
	background: var(--xb-track);
	cursor: pointer;
	transition: background-color 160ms var(--xb-ease-out), border-color 160ms var(--xb-ease-out);
}
.xb-opt-switch::before {
	content: "";
	position: absolute;
	top: 3px;
	left: 3px;
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: oklch(1 0 0);
	transition: transform 160ms var(--xb-ease-out);
}
.xb-opt-switch:checked { background: var(--xb-primary); border-color: var(--xb-primary); }
.xb-opt-switch:checked::before { transform: translateX(18px); }
.xb-opt-switch:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-opt-switch:disabled { opacity: 0.45; cursor: default; }
.xb-opt-switch:active { transform: scale(0.96); }

/* ---- Slider + numeric pair (Max replies) ---- */
.xb-opt-slider-row { display: flex; align-items: center; gap: 12px; }
.xb-opt-slider {
	width: 220px;
	accent-color: var(--xb-primary);
}
.xb-opt-slider:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-opt-number {
	box-sizing: border-box;
	width: 56px;
	height: 32px;
	border: 1px solid var(--xb-border);
	border-radius: 8px;
	background: var(--xb-surface);
	color: var(--xb-ink);
	padding: 0 8px;
	font: inherit;
	font-size: 13px;
	font-variant-numeric: tabular-nums;
	text-align: right;
}
.xb-opt-number:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }

/* ---- Toolbar (whitelist / blocked log) ---- */
.xb-opt-toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-bottom: 16px;
}
.xb-opt-toolbar-spacer { flex: 1 1 auto; }
.xb-opt-input {
	box-sizing: border-box;
	height: 36px;
	min-width: 0;
	border: 1px solid var(--xb-border);
	border-radius: 10px;
	background: var(--xb-surface);
	color: var(--xb-ink);
	padding: 0 12px;
	font: inherit;
	font-size: 13px;
}
.xb-opt-input:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-opt-input[data-invalid="true"] { border-color: var(--xb-danger); }
.xb-opt-field-caption { margin: 6px 0 0; font-size: 11px; font-weight: 500; color: var(--xb-ink-muted); }
.xb-opt-field-caption[data-tone="danger"] { color: var(--xb-danger); }

.xb-opt-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 36px;
	padding: 0 14px;
	border-radius: 10px;
	border: 1px solid transparent;
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
	transition: background-color 150ms ease, filter 150ms ease, transform 160ms var(--xb-ease-out);
}
.xb-opt-btn:active { transform: scale(0.96); }
.xb-opt-btn:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-opt-btn:disabled { opacity: 0.45; cursor: default; }
.xb-opt-btn[data-variant="primary"] { background: var(--xb-primary); color: white; }
.xb-opt-btn[data-variant="secondary"] { background: transparent; border-color: var(--xb-border); color: var(--xb-ink); }
.xb-opt-btn[data-variant="danger"] { background: var(--xb-danger); color: white; }
.xb-opt-btn[data-reserve] { min-width: var(--xb-opt-btn-reserve, auto); }
@media (hover: hover) and (pointer: fine) {
	.xb-opt-btn[data-variant="primary"]:hover { filter: brightness(1.1); }
	.xb-opt-btn[data-variant="secondary"]:hover { background: var(--xb-track); }
	.xb-opt-btn[data-variant="danger"]:hover { filter: brightness(1.1); }
}

/* ---- Chips ---- */
.xb-opt-chip-group { display: inline-flex; gap: 4px; padding: 2px; border-radius: 10px; background: var(--xb-track); }
.xb-opt-chip {
	height: 28px;
	padding: 0 10px;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: var(--xb-ink-muted);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	transition: background-color 150ms ease, color 150ms ease;
}
.xb-opt-chip[aria-pressed="true"] { background: var(--xb-surface); color: var(--xb-ink); }
.xb-opt-chip:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }

/* ---- Tables (two row heights in the whole surface: 40 flat, 36 virtualized) ---- */
.xb-opt-table { width: 100%; border: 1px solid var(--xb-border); border-radius: 16px; overflow: hidden; }
.xb-opt-table-head, .xb-opt-table-row {
	display: grid;
	align-items: center;
	gap: 12px;
	padding: 0 16px;
}
.xb-opt-table-head {
	height: 36px;
	background: var(--xb-elevated);
	border-bottom: 1px solid var(--xb-border);
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--xb-ink-muted);
}
.xb-opt-table-row {
	height: 40px;
	border-bottom: 1px solid var(--xb-border);
	font-size: 13px;
}
.xb-opt-table-row:last-child { border-bottom: none; }
@media (hover: hover) and (pointer: fine) {
	.xb-opt-table-row:hover { background: var(--xb-track); }
}
.xb-opt-table-row:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: -2px; }
.xb-opt-cell-handle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xb-opt-cell-action { display: inline-flex; align-items: center; gap: 8px; }
.xb-opt-tone-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.xb-opt-tone-dot[data-tone="danger"] { background: var(--xb-danger); }
.xb-opt-tone-dot[data-tone="warning"] { background: var(--xb-warning); }
.xb-opt-sync-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.xb-opt-sync-dot[data-sync="synced"] { background: var(--xb-success); }
.xb-opt-sync-dot[data-sync="pending"] { background: var(--xb-warning); }
.xb-opt-sync-dot[data-sync="local"] { background: transparent; border: 1px solid var(--xb-ink-muted); }
.xb-opt-cell-when { font-variant-numeric: tabular-nums; color: var(--xb-ink-muted); }

.xb-opt-ghost-icon {
	display: grid;
	place-items: center;
	width: 28px;
	height: 28px;
	border: none;
	border-radius: 8px;
	background: transparent;
	color: var(--xb-ink-muted);
	cursor: pointer;
	opacity: 0;
	transition: opacity 150ms ease, background-color 150ms ease, color 150ms ease;
}
.xb-opt-table-row:hover .xb-opt-ghost-icon,
.xb-opt-ghost-icon:focus-visible,
.xb-opt-ghost-icon:focus-within {
	opacity: 1;
}
.xb-opt-ghost-icon:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) {
	.xb-opt-ghost-icon:hover { background: var(--xb-track); color: var(--xb-danger); }
}
.xb-opt-ghost-icon[data-confirming="true"] {
	opacity: 1;
	width: auto;
	padding: 0 10px;
	color: var(--xb-danger);
	font-size: 11px;
	font-weight: 700;
}

.xb-opt-empty {
	display: grid;
	place-items: center;
	gap: 4px;
	padding: 48px 16px;
	text-align: center;
	border: 1px solid var(--xb-border);
	border-radius: 16px;
	background: var(--xb-elevated);
}
.xb-opt-empty p { margin: 0; }
.xb-opt-empty p:first-child { font-size: 13px; font-weight: 600; }
.xb-opt-empty p:last-child { font-size: 12px; font-weight: 500; color: var(--xb-ink-muted); }

.xb-opt-table-scroll { position: relative; max-height: 560px; overflow-y: auto; }
.xb-opt-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 12px;
	font-size: 12px;
	font-weight: 500;
	color: var(--xb-ink-muted);
}
.xb-opt-tabular { font-variant-numeric: tabular-nums; color: var(--xb-ink); font-weight: 600; }
.xb-opt-jump-top {
	height: 36px;
	padding: 0 12px;
	border: 1px solid var(--xb-border);
	border-radius: 10px;
	background: var(--xb-elevated);
	color: var(--xb-ink);
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}
.xb-opt-jump-top:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-opt-jump-top[hidden] { display: none; }

/* ---- Danger zone ---- */
.xb-opt-card[data-danger="true"] { border-color: oklch(0.601 0.212 21 / 0.35); }
.xb-opt-card[data-danger="true"] .xb-opt-card-header h2 { color: var(--xb-danger); }
.xb-opt-danger-body { padding: 0 20px 16px; font-size: 12px; font-weight: 500; color: var(--xb-ink-muted); }
.xb-opt-danger-actions { padding: 0 20px 20px; }
.xb-opt-wipe-panel {
	overflow: hidden;
	max-height: 0;
	opacity: 0;
	transition: max-height 200ms var(--xb-ease-out), opacity 200ms var(--xb-ease-out);
	padding: 0 20px;
}
.xb-opt-wipe-panel[data-open="true"] { max-height: 160px; opacity: 1; padding: 0 20px 20px; }
.xb-opt-wipe-row { display: flex; gap: 8px; align-items: center; }

/* ---- About ---- */
.xb-opt-about-mark {
	display: grid;
	place-items: center;
	width: 32px;
	height: 32px;
	border-radius: 10px;
	background: oklch(0.63 0.16 246 / 0.12);
	color: var(--xb-primary);
	margin-bottom: 12px;
}
.xb-opt-about-version {
	margin: 0 0 12px;
	font-size: 13px;
	font-weight: 500;
	font-variant-numeric: tabular-nums;
	color: var(--xb-ink-muted);
}
.xb-opt-about-tagline {
	margin: 0 0 16px;
	max-width: 46ch;
	font-size: 13px;
	font-weight: 500;
	line-height: 1.5;
	color: var(--xb-ink);
}
.xb-opt-link-row {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--xb-primary);
	font-size: 13px;
	font-weight: 600;
	text-decoration: none;
}
.xb-opt-link-row:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
`;

export function ensureOptionsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = SHEET;
  document.head.appendChild(style);
}
