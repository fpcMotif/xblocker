// Settings-page stylesheet. Unlike content/styles.ts (which reads x.com's own surface via
// content/theme.ts's detectTheme), this is a standalone extension tab with no host page to
// inspect, so it follows the OS preference directly: light tokens by default, dark tokens
// under a `prefers-color-scheme: dark` override, plus `color-scheme: light dark` so native
// form controls (scrollbars, range thumbs) pick a matching chrome.

import { XB_FONT_STACK } from "../lib/design-tokens";

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
@media (prefers-reduced-motion: reduce) {
	.xb-opt-root, .xb-opt-root * { transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; }
}

html { scrollbar-gutter: stable; }

.xb-opt-nav-indicator::before {
	content: "";
	position: absolute;
	left: -8px;
	top: 4px;
	bottom: 4px;
	width: 2px;
	border-radius: 2px;
	background: var(--xb-primary);
}
.xb-opt-nav-item { z-index: 1; }

label.xb-opt-row { cursor: pointer; }

.xb-opt-input[data-invalid="true"] { border-color: var(--xb-danger); }
.xb-opt-field-caption[data-tone="danger"] { color: var(--xb-danger); }

.xb-opt-btn:disabled { cursor: default; }
@media (hover: hover) and (pointer: fine) {
	.xb-opt-btn[data-variant="primary"]:hover:not(:disabled),
	.xb-opt-btn[data-variant="danger"]:hover:not(:disabled) { filter: brightness(1.1); }
	.xb-opt-btn[data-variant="secondary"]:hover:not(:disabled) { background: var(--xb-track); }
	.xb-opt-chip[aria-pressed="false"]:hover { color: var(--xb-ink); }
}

.xb-opt-chip[aria-pressed="true"] {
	background: var(--xb-surface);
	color: var(--xb-ink);
	box-shadow: 0 1px 2px oklch(0 0 0 / 0.1), 0 0 0 0.5px oklch(0 0 0 / 0.06);
}

.xb-opt-table-row:hover .xb-opt-ghost-icon,
.xb-opt-table-row:focus-within .xb-opt-ghost-icon,
.xb-opt-ghost-icon[data-confirming="true"] { opacity: 1; }
@media (hover: none) {
	.xb-opt-ghost-icon { opacity: 1; }
}
.xb-opt-ghost-icon[data-confirming="true"] {
	padding: 0 10px;
	background: oklch(0.601 0.212 21 / 0.12);
	color: var(--xb-danger);
	font-size: 11px;
	font-weight: 700;
}

.xb-opt-wipe-panel[data-open="true"] { max-height: 200px; opacity: 1; padding-bottom: 20px; }

.xb-opt-empty p { margin: 0; font-size: 13px; font-weight: 600; }
.xb-opt-empty p + p { font-size: 12px; font-weight: 500; color: var(--xb-ink-muted); }

.xb-opt-collection .xb-opt-row-meta { border-bottom-style: none; }
.xb-opt-collection .xb-opt-row-meta:last-child { border-bottom-style: solid; }
.xb-opt-collection .xb-opt-row-meta + .xb-opt-row-meta { min-height: 32px; padding-top: 0; }
.xb-opt-collection .xb-opt-row-meta + .xb-opt-row-meta .xb-opt-row-title {
	font-weight: 500;
	color: var(--xb-ink-muted);
}
.xb-opt-row-value[data-state] { display: inline-flex; align-items: center; gap: 8px; }
.xb-opt-row-value[data-state]::before {
	content: "";
	width: 6px;
	height: 6px;
	border-radius: 999px;
	background: var(--xb-success);
}
.xb-opt-row-value[data-state="off"]::before {
	background: transparent;
	box-shadow: inset 0 0 0 1px var(--xb-ink-muted);
}
.xb-opt-row-value[data-state="error"]::before { background: var(--xb-danger); }
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
.xb-opt-switch:disabled { opacity: 0.45; cursor: default; }
.xb-opt-switch:active { transform: scale(0.96); }

`;

export function ensureOptionsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = SHEET;
  document.head.appendChild(style);
}
