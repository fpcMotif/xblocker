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
