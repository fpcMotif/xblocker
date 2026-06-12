const STYLE_ID = "xblocker-styles";

const SHEET = `
.xb-root {
	--xb-primary: oklch(0.63 0.16 246);
	--xb-danger: oklch(0.601 0.212 21);
	--xb-success: oklch(0.646 0.152 154);
	--xb-warning: oklch(0.778 0.158 74);
	--xb-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
	--xb-ease-icon: cubic-bezier(0.2, 0, 0, 1);
	font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	-webkit-font-smoothing: antialiased;
	box-sizing: border-box;
}
.xb-root *, .xb-root *::before, .xb-root *::after {
	box-sizing: border-box;
}
.xb-root[data-xb-theme="dark"] {
	--xb-surface: oklch(0.24 0.023 251 / 0.92);
	--xb-elevated: oklch(0.284 0.025 249);
	--xb-ink: oklch(0.962 0.009 248);
	--xb-ink-muted: oklch(0.962 0.009 248 / 0.62);
	--xb-border: oklch(0.962 0.009 248 / 0.14);
	--xb-track: oklch(0.962 0.009 248 / 0.16);
	--xb-shadow: 0 0 0 1px oklch(0 0 0 / 0.28), 0 2px 6px oklch(0 0 0 / 0.3), 0 12px 32px oklch(0 0 0 / 0.42);
}
.xb-root[data-xb-theme="light"] {
	--xb-surface: oklch(1 0 0 / 0.92);
	--xb-elevated: oklch(0.984 0.003 248);
	--xb-ink: oklch(0.24 0.023 251);
	--xb-ink-muted: oklch(0.24 0.023 251 / 0.6);
	--xb-border: oklch(0.906 0.015 251);
	--xb-track: oklch(0.24 0.023 251 / 0.1);
	--xb-shadow: 0 0 0 1px oklch(0 0 0 / 0.04), 0 2px 6px oklch(0 0 0 / 0.08), 0 12px 32px oklch(0 0 0 / 0.12);
}

/* ---- Cursor Console ---- */
.xb-console {
	position: fixed;
	top: 0;
	left: 0;
	z-index: 10001;
	will-change: transform;
	pointer-events: none;
}
.xb-console-card {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px;
	border-radius: 14px;
	background: var(--xb-surface);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
	backdrop-filter: blur(16px);
	opacity: 0;
	transform: scale(0.96) translateY(2px);
	transition: opacity 120ms var(--xb-ease-out), transform 120ms var(--xb-ease-out);
	pointer-events: none;
}
.xb-console[data-state="open"] .xb-console-card {
	opacity: 1;
	transform: scale(1) translateY(0);
	transition-duration: 160ms;
	pointer-events: auto;
}
.xb-console[data-flip-x="false"][data-flip-y="false"] .xb-console-card { transform-origin: top left; }
.xb-console[data-flip-x="true"][data-flip-y="false"] .xb-console-card { transform-origin: top right; }
.xb-console[data-flip-x="false"][data-flip-y="true"] .xb-console-card { transform-origin: bottom left; }
.xb-console[data-flip-x="true"][data-flip-y="true"] .xb-console-card { transform-origin: bottom right; }
.xb-console-user {
	display: flex;
	align-items: center;
	height: 34px;
	padding: 0 4px 0 10px;
	color: var(--xb-ink-muted);
	font-size: 12px;
	font-weight: 600;
	line-height: 1;
	white-space: nowrap;
	max-width: 14ch;
	overflow: hidden;
	text-overflow: ellipsis;
}
.xb-console[data-whitelisted="true"] .xb-console-user { color: var(--xb-success); }
.xb-divider-v {
	width: 1px;
	height: 18px;
	background: var(--xb-border);
	flex-shrink: 0;
}

/* ---- Action buttons (shared by console and dock) ---- */
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
.xb-btn:disabled { cursor: default; }
.xb-btn:focus-visible {
	outline: 2px solid var(--xb-primary);
	outline-offset: 1px;
}
@media (hover: hover) and (pointer: fine) {
	.xb-btn[data-action="block"]:hover { background: oklch(0.601 0.212 21 / 0.12); color: var(--xb-danger); }
	.xb-btn[data-action="mute"]:hover { background: oklch(0.778 0.158 74 / 0.14); color: var(--xb-warning); }
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

/* ---- Dock ---- */
.xb-dock {
	position: fixed;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	width: 50px;
	padding: 8px;
	border-radius: 16px;
	background: var(--xb-surface);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
	backdrop-filter: blur(16px);
}
.xb-dock .xb-btn { width: 32px; height: 32px; border-radius: 8px; }
.xb-dock .xb-btn::after { inset: -4px; }
.xb-dock-handle {
	color: var(--xb-ink-muted);
	cursor: grab;
	touch-action: none;
}
.xb-dock-handle:active { cursor: grabbing; transform: none; }
.xb-divider-h {
	width: 26px;
	height: 1px;
	background: var(--xb-border);
	flex-shrink: 0;
	margin: 2px 0;
}
.xb-ring {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
}
.xb-ring-track { stroke: var(--xb-track); }
.xb-ring-bar {
	stroke: var(--xb-primary);
	transition: stroke-dashoffset 240ms linear;
}
.xb-ring-count {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: var(--xb-ink);
}

/* ---- Toast ---- */
.xb-toast {
	position: fixed;
	top: 24px;
	right: 24px;
	z-index: 10003;
	display: flex;
	align-items: center;
	gap: 8px;
	max-width: 320px;
	padding: 12px 16px;
	border-radius: 12px;
	background: var(--xb-surface);
	border: 1px solid var(--xb-border);
	box-shadow: var(--xb-shadow);
	backdrop-filter: blur(16px);
	color: var(--xb-ink);
	font-size: 13px;
	font-weight: 500;
	line-height: 1.4;
	cursor: pointer;
	opacity: 0;
	transform: translateY(-8px);
	transition: opacity 200ms var(--xb-ease-out), transform 200ms var(--xb-ease-out);
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
	transition: opacity 160ms var(--xb-ease-out);
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
.xb-modal-cancel {
	background: transparent;
	border-color: var(--xb-border);
	color: var(--xb-ink-muted);
}
.xb-modal-confirm {
	background: var(--xb-success);
	color: oklch(1 0 0);
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
	.xb-console-card, .xb-toast, .xb-modal, .xb-modal-backdrop {
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
