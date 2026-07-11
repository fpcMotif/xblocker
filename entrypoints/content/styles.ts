import {
  XB_DARK_TOKENS,
  XB_FONT_STACK,
  XB_LIGHT_TOKENS,
  XB_TONE_TOKENS,
} from "../lib/design-tokens";
import { MODAL_EXIT_MS } from "./modal";

const STYLE_ID = "xblocker-styles";

const SHEET = `
.xb-root {${XB_TONE_TOKENS}	font-family: ${XB_FONT_STACK};
	-webkit-font-smoothing: antialiased;
	box-sizing: border-box;
}
.xb-root *, .xb-root *::before, .xb-root *::after {
	box-sizing: border-box;
}
.xb-root[data-xb-theme="dark"] {${XB_DARK_TOKENS}}
.xb-root[data-xb-theme="light"] {${XB_LIGHT_TOKENS}}

/* ---- Action buttons (shared icon-only base) ---- */
.xb-btn {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 34px;
	height: 34px;
	padding: 0;
	border: none;
	border-radius: 10px;
	background: transparent;
	color: var(--xb-ink);
	cursor: pointer;
	font-family: inherit;
	transition: background-color 150ms ease, color 150ms ease, transform 160ms var(--xb-ease-out);
}
.xb-btn::after {
	content: "";
	position: absolute;
	inset: -3px;
}
.xb-btn:active { transform: scale(0.96); }
.xb-btn:disabled { cursor: default; opacity: 0.45; }
.xb-btn-labeled:disabled { opacity: 0.45; }
.xb-btn:focus-visible {
	outline: 2px solid var(--xb-primary);
	outline-offset: 1px;
}
@media (hover: hover) and (pointer: fine) {
	.xb-btn[data-action="whitelist"]:hover { background: oklch(0.646 0.152 154 / 0.12); color: var(--xb-success); }
	.xb-btn[data-action="settings"]:hover { background: var(--xb-track); }
	.xb-btn[data-action="drag"]:hover { color: var(--xb-ink); }
}
.xb-btn[data-whitelisted="true"] { color: var(--xb-success); }

/* Stacked icon slots: cross-fade with blur instead of swapping nodes */
.xb-icon {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: opacity 200ms var(--xb-ease-icon), transform 200ms var(--xb-ease-icon), filter 200ms var(--xb-ease-icon);
}
.xb-icon-status {
	opacity: 0;
	transform: scale(0.25);
	filter: blur(4px);
}
.xb-btn[data-state="busy"] .xb-icon-main,
.xb-btn[data-state="success"] .xb-icon-main,
.xb-btn[data-state="error"] .xb-icon-main {
	opacity: 0;
	transform: scale(0.25);
	filter: blur(4px);
}
.xb-btn[data-state="busy"] .xb-icon-status,
.xb-btn[data-state="success"] .xb-icon-status,
.xb-btn[data-state="error"] .xb-icon-status {
	opacity: 1;
	transform: scale(1);
	filter: blur(0px);
}
.xb-btn[data-state="success"] { color: var(--xb-success); }
.xb-btn[data-state="error"] { color: var(--xb-danger); }
.xb-spin { animation: xb-spin 0.8s linear infinite; }
@keyframes xb-spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}

/* ---- Labeled bulk-action buttons (Block all / Mute all) ---- */
.xb-btn-labeled {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: flex-start;
	gap: 8px;
	width: 100%;
	height: 38px;
	padding: 0 10px;
	border: 1px solid transparent;
	border-radius: 10px;
	background: transparent;
	color: var(--xb-ink);
	cursor: pointer;
	overflow: hidden;
	font-family: inherit;
	transition: background-color 150ms ease, border-color 150ms ease, filter 150ms ease, transform 160ms var(--xb-ease-out);
}
.xb-btn-labeled:active { transform: scale(0.98); }
.xb-btn-labeled:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 1px; }
.xb-btn-labeled[data-variant="hero"] { background: var(--xb-hero-bg); color: var(--xb-hero-ink); }
.xb-btn-labeled[data-variant="secondary"] { border-color: var(--xb-border); color: var(--xb-ink); }
@media (hover: hover) and (pointer: fine) {
	.xb-btn-labeled[data-variant="hero"]:hover { filter: brightness(1.12); }
	.xb-btn-labeled[data-variant="secondary"]:hover { background: var(--xb-track); }
}
.xb-btn-icon {
	position: relative;
	width: 18px;
	height: 18px;
	flex-shrink: 0;
}
.xb-btn-text {
	font-size: 13px;
	font-weight: 600;
	line-height: 1;
	white-space: nowrap;
}
.xb-btn-labeled .xb-count {
	margin-left: auto;
	min-width: 20px;
	padding: 1px 7px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	text-align: center;
}
.xb-btn-labeled[data-variant="hero"] .xb-count { background: oklch(1 0 0 / 0.18); color: inherit; }
.xb-btn-labeled[data-variant="secondary"] .xb-count { color: var(--xb-ink-muted); }
.xb-btn-labeled[data-progress]::before {
	content: "";
	position: absolute;
	left: 0;
	bottom: 0;
	height: 3px;
	width: calc(var(--xb-progress, 0) * 100%);
	background: var(--xb-primary);
	transition: width 200ms linear;
}

/* ---- Reply Rail ---- */
.xb-rail {
	position: fixed;
	z-index: 10000;
	font-family: inherit;
}
.xb-rail-body {
	display: flex;
	flex-direction: column;
	gap: 7px;
	width: 168px;
	padding: 10px;
	border-radius: 20px;
	background: var(--xb-surface);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
}
.xb-rail-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 2px;
}
.xb-rail-title {
	font-size: 12px;
	font-weight: 600;
	color: var(--xb-ink-muted);
}
.xb-rail-handle {
	width: 24px;
	height: 24px;
	border-radius: 8px;
	color: var(--xb-ink-muted);
	cursor: grab;
	touch-action: none;
}
.xb-rail-handle:active { cursor: grabbing; transform: none; }
.xb-divider-h {
	width: 100%;
	height: 1px;
	background: var(--xb-border);
	flex-shrink: 0;
	margin: 3px 0 1px;
}
.xb-rail-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.xb-rail-footer-actions { display: flex; gap: 2px; }
.xb-rail-footer .xb-btn { width: 30px; height: 30px; border-radius: 8px; color: var(--xb-ink-muted); }
.xb-session {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	font-size: 11px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	color: var(--xb-ink-muted);
}
.xb-session-count { line-height: 1; }

/* ---- Collapsed puck ---- */
.xb-puck {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 46px;
	height: 46px;
	padding: 0;
	border: 1px solid var(--xb-border);
	border-radius: 999px;
	background: var(--xb-surface);
	box-shadow: var(--xb-shadow);
	color: var(--xb-primary);
	cursor: grab;
	touch-action: none;
	transition: transform 160ms var(--xb-ease-out);
}
.xb-puck:active { cursor: grabbing; transform: scale(0.96); }
.xb-puck:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) {
	.xb-puck:hover { border-color: var(--xb-primary); transform: scale(1.04); }
}
.xb-puck-count {
	position: absolute;
	top: -3px;
	right: -3px;
	min-width: 17px;
	height: 17px;
	padding: 0 4px;
	border-radius: 999px;
	background: var(--xb-primary);
	color: oklch(1 0 0);
	font-size: 10px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	display: flex;
	align-items: center;
	justify-content: center;
}
.xb-session[hidden], .xb-puck-count[hidden] { display: none; }

/* State-driven surface swap: puck at rest, body when active */
.xb-rail[data-state="collapsed"] .xb-rail-body { display: none; }
.xb-rail:not([data-state="collapsed"]) .xb-puck { display: none; }

/* ---- Cursor Console (per-reply quick actions) ---- */
.xb-console {
	position: absolute;
	top: 8px;
	right: 8px;
	z-index: 9999;
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 3px;
	border-radius: 12px;
	background: var(--xb-surface);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
	opacity: 0;
	transform: translateY(-4px) scale(0.96);
	pointer-events: none;
	transition: opacity 160ms var(--xb-ease-out), transform 160ms var(--xb-ease-out);
}
article[data-testid="tweet"]:hover .xb-console,
.xb-console:hover,
.xb-console:focus-within {
	opacity: 1;
	transform: translateY(0) scale(1);
	pointer-events: auto;
}
.xb-console .xb-btn {
	width: 30px;
	height: 30px;
	border-radius: 9px;
	color: var(--xb-ink-muted);
}
@media (hover: hover) and (pointer: fine) {
	.xb-console .xb-btn[data-action="block"]:hover { background: oklch(0.601 0.212 21 / 0.12); color: var(--xb-danger); }
	.xb-console .xb-btn[data-action="mute"]:hover { background: var(--xb-track); color: var(--xb-ink); }
	.xb-console .xb-btn[data-action="whitelist"]:hover { background: oklch(0.646 0.152 154 / 0.12); color: var(--xb-success); }
}

/* ---- Toast ---- */
.xb-toast-region {
	position: fixed;
	top: 24px;
	right: 24px;
	z-index: 10003;
	display: flex;
	flex-direction: column;
	gap: 8px;
	pointer-events: none;
}
.xb-toast {
	position: static;
	pointer-events: auto;
	display: flex;
	align-items: center;
	gap: 8px;
	max-width: 320px;
	padding: 12px 16px;
	border-radius: 12px;
	background: var(--xb-surface);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
	color: var(--xb-ink);
	font-size: 13px;
	font-weight: 500;
	line-height: 1.4;
	cursor: pointer;
	opacity: 0;
	transform: translateY(-8px);
	transition: opacity 200ms var(--xb-ease-out), transform 200ms var(--xb-ease-out);
}
.xb-toast:focus-visible {
	outline: 2px solid var(--xb-primary);
	outline-offset: 2px;
}
.xb-toast[data-state="open"] {
	opacity: 1;
	transform: translateY(0);
}
.xb-toast[data-state="closed"] {
	opacity: 0;
	transform: translateY(-4px);
	transition-duration: 150ms;
}
.xb-toast-dot {
	width: 8px;
	height: 8px;
	border-radius: 9999px;
	flex-shrink: 0;
	background: var(--xb-primary);
}
.xb-toast[data-type="success"] .xb-toast-dot { background: var(--xb-success); }
.xb-toast[data-type="warning"] .xb-toast-dot { background: var(--xb-warning); }

/* ---- Whitelist modal ---- */
.xb-modal-backdrop {
	position: fixed;
	inset: 0;
	z-index: 10002;
	display: flex;
	align-items: center;
	justify-content: center;
	background: oklch(0 0 0 / 0.4);
	backdrop-filter: blur(8px);
	opacity: 0;
	transition: opacity ${MODAL_EXIT_MS}ms var(--xb-ease-out);
}
.xb-modal-backdrop[data-state="open"] { opacity: 1; }
.xb-modal {
	width: 90%;
	max-width: 380px;
	padding: 20px;
	border-radius: 16px;
	background: var(--xb-elevated);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
	color: var(--xb-ink);
	opacity: 0;
	transform: scale(0.96) translateY(4px);
	transition: opacity 200ms var(--xb-ease-out), transform 200ms var(--xb-ease-out);
}
.xb-modal-backdrop[data-state="open"] .xb-modal {
	opacity: 1;
	transform: scale(1) translateY(0);
}
.xb-modal h3 {
	margin: 0 0 8px;
	font-size: 16px;
	font-weight: 700;
	text-wrap: balance;
}
.xb-modal p {
	margin: 0 0 14px;
	font-size: 13px;
	color: var(--xb-ink-muted);
	text-wrap: pretty;
}
.xb-modal input {
	width: 100%;
	height: 38px;
	padding: 0 12px;
	border: 1px solid var(--xb-border);
	border-radius: 10px;
	background: transparent;
	color: var(--xb-ink);
	font-family: inherit;
	font-size: 13px;
	outline: none;
	transition: border-color 150ms ease;
}
.xb-modal input:focus { border-color: var(--xb-primary); }
.xb-modal-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 14px;
}
.xb-modal-actions button {
	height: 34px;
	padding: 0 14px;
	border-radius: 10px;
	border: 1px solid transparent;
	font-family: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 160ms var(--xb-ease-out);
}
.xb-modal-actions button:active { transform: scale(0.96); }
.xb-modal-actions button:focus-visible { outline: 2px solid var(--xb-primary); outline-offset: 2px; }
.xb-modal-actions button:disabled { opacity: 0.5; cursor: default; }
.xb-modal-cancel {
	background: transparent;
	border-color: var(--xb-border);
	color: var(--xb-ink-muted);
}
.xb-modal-confirm {
	background: var(--xb-success);
	color: oklch(1 0 0);
}
@media (hover: hover) and (pointer: fine) {
	.xb-modal-cancel:hover { background: var(--xb-track); }
	.xb-modal-confirm:hover { filter: brightness(1.08); }
}

/* ---- Blocked reply veil ---- */
article[data-xb-blocked="true"] {
	opacity: 0.45;
	transition: opacity 200ms var(--xb-ease-out);
}

/* ---- Reduced motion: keep gentle fades, drop movement ---- */
@media (prefers-reduced-motion: reduce) {
	.xb-root, .xb-root *, .xb-root *::before, .xb-root *::after {
		animation-duration: 0.01ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.01ms !important;
	}
	.xb-rail-body, .xb-puck, .xb-toast, .xb-modal, .xb-modal-backdrop, .xb-console {
		transition-property: opacity;
		transition-duration: 120ms !important;
		transform: none;
	}
}
`;

export function ensureStyles(): void {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = SHEET;
}
