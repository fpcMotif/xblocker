// Gauge & Ledger popup: a lean status strip (see
// docs/plans/2026-07-10-gauge-and-ledger/plan.md, "Popup"). Whitelist management and
// max-replies now live on the settings page; this surface only shows the stat strip,
// two behavior toggles, the cloud sync row, and a link out to settings.
import type { BlockedStats } from "../lib/blocked-merge";
import { blockedStore } from "../lib/blocked-store";
import { CLOUD_BACKUP_KEY, SETTINGS_KEY, storageGet, storageSet } from "../lib/chrome-storage";
import { createCloudSyncSession, type CloudSyncDeps } from "../lib/cloud-session";
import {
  XB_DARK_TOKENS,
  XB_FONT_STACK,
  XB_LIGHT_TOKENS,
  XB_TONE_TOKENS,
} from "../lib/design-tokens";
import { createIcon } from "../lib/icons";
import { createLiveNumber, type LiveNumber, type LiveNumberClock } from "../lib/live-number";
import { readSettings, type Settings } from "../lib/settings";
import { getWhitelist } from "../lib/whitelist-store";

// The popup renders rows for only two of the four settings keys (keyboardMode is reserved
// for future j/k navigation; maxReplies lives on the settings page) but always round-trips
// the whole Settings blob, so a save here never drops the fields other readers depend on.
function saveSettings(settings: Settings): void {
  void storageSet({ [SETTINGS_KEY]: settings });
}

/** Guarded so the test chrome mock (which has no openOptionsPage) never throws. */
function openSettings(): void {
  void chrome.runtime.openOptionsPage?.();
}

function ensurePopupStyles(): void {
  if (document.getElementById("xblocker-popup-styles")) return;

  const style = document.createElement("style");
  style.id = "xblocker-popup-styles";
  style.textContent = `
		:root {${XB_TONE_TOKENS}${XB_LIGHT_TOKENS}	color-scheme: light dark;
		}
		@media (prefers-color-scheme: dark) {
			:root {${XB_DARK_TOKENS}}
		}

		body {
			width: 360px;
			margin: 0;
			background: var(--xb-surface);
			color: var(--xb-ink);
			font-family: ${XB_FONT_STACK};
			-webkit-font-smoothing: antialiased;
		}

		.xb-popup {
			box-sizing: border-box;
			width: 360px;
			padding: 14px 16px;
		}

		.xb-region + .xb-region {
			border-top: 1px solid var(--xb-border);
		}

		.xb-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding-bottom: 12px;
		}

		.xb-brand {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}

		.xb-brand-mark {
			display: grid;
			place-items: center;
			flex: 0 0 auto;
			width: 22px;
			height: 22px;
			border-radius: 8px;
			background: oklch(0.63 0.16 246 / 0.12);
			color: var(--xb-primary);
		}

		.xb-header h1 {
			margin: 0;
			font-size: 15px;
			line-height: 1.2;
			font-weight: 700;
			color: var(--xb-ink);
		}

		.xb-status {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			color: var(--xb-ink-muted);
			font-size: 12px;
			font-weight: 600;
			white-space: nowrap;
		}

		.xb-status-dot {
			flex: 0 0 auto;
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--xb-success);
		}

		.xb-stat-strip {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			align-items: center;
			min-height: 64px;
			padding: 10px 0;
		}

		.xb-stat-cell {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 4px;
			padding: 0 4px;
			border-left: 1px solid var(--xb-border);
		}

		.xb-stat-cell:first-child {
			border-left: 0;
		}

		.xb-stat-value {
			font-size: 26px;
			line-height: 1;
			font-weight: 700;
			color: var(--xb-ink);
			font-variant-numeric: tabular-nums;
		}

		.xb-stat-tick {
			width: 20px;
			height: 2px;
			border-radius: 1px;
		}

		.xb-stat-tick[data-tone="danger"] { background: var(--xb-danger); }
		.xb-stat-tick[data-tone="warning"] { background: var(--xb-warning); }
		.xb-stat-tick[data-tone="success"] { background: var(--xb-success); }

		.xb-stat-label {
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--xb-ink-muted);
		}

		.xb-toggles {
			padding: 2px 0;
		}

		.xb-toggle-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 44px;
			padding: 8px 0;
			cursor: pointer;
		}

		.xb-toggle-row + .xb-toggle-row {
			border-top: 1px solid var(--xb-border);
		}

		.xb-toggle-copy {
			display: grid;
			gap: 2px;
			min-width: 0;
		}

		.xb-toggle-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--xb-ink);
		}

		.xb-toggle-caption {
			font-size: 11px;
			font-weight: 500;
			line-height: 1.3;
			color: var(--xb-ink-muted);
		}

		.xb-switch {
			appearance: none;
			position: relative;
			flex: 0 0 auto;
			box-sizing: border-box;
			width: 42px;
			height: 24px;
			margin: 0;
			border-radius: 999px;
			border: 1px solid var(--xb-border);
			background: var(--xb-track);
			cursor: pointer;
			transition: background-color 160ms var(--xb-ease-out), border-color 160ms var(--xb-ease-out);
		}

		.xb-switch::before {
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

		.xb-switch:checked {
			border-color: var(--xb-primary);
			background: var(--xb-primary);
		}

		.xb-switch:checked::before {
			transform: translateX(18px);
		}

		.xb-switch:active {
			transform: scale(0.96);
		}

		.xb-switch:focus-visible {
			outline: 2px solid var(--xb-primary);
			outline-offset: 2px;
		}

		.xb-sync-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 48px;
			padding: 10px 0;
		}

		.xb-sync-left {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}

		.xb-telltale {
			box-sizing: border-box;
			flex: 0 0 auto;
			width: 8px;
			height: 8px;
			border-radius: 50%;
			border: 1.5px solid var(--xb-ink-muted);
			background: transparent;
		}

		.xb-telltale[data-state="idle"] {
			border-color: var(--xb-success);
			background: var(--xb-success);
		}

		.xb-telltale[data-state="syncing"] {
			border-color: var(--xb-primary);
			background: var(--xb-primary);
			animation: xb-breathe 900ms ease-in-out infinite;
		}

		.xb-telltale[data-state="error"] {
			border-color: var(--xb-danger);
			background: var(--xb-danger);
			animation: xb-blink-error 900ms ease-in-out 1;
		}

		@keyframes xb-breathe {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.4; }
		}

		@keyframes xb-blink-error {
			0%, 100% { opacity: 1; }
			15% { opacity: 0.25; }
			30% { opacity: 1; }
			45% { opacity: 0.25; }
			60% { opacity: 1; }
		}

		.xb-sync-copy {
			display: grid;
			gap: 2px;
			min-width: 0;
		}

		.xb-sync-title {
			font-size: 12px;
			font-weight: 600;
			color: var(--xb-ink);
		}

		.xb-sync-detail {
			font-size: 11px;
			font-weight: 500;
			color: var(--xb-ink-muted);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.xb-sync-action {
			flex: 0 0 auto;
		}

		.xb-sync-note {
			font-size: 11px;
			font-weight: 500;
			color: var(--xb-ink-muted);
			white-space: nowrap;
		}

		.xb-ghost-link {
			border: 0;
			background: transparent;
			padding: 4px 0;
			color: var(--xb-primary);
			font: inherit;
			font-size: 12px;
			font-weight: 600;
			cursor: pointer;
			white-space: nowrap;
		}

		.xb-ghost-link:focus-visible {
			outline: 2px solid var(--xb-primary);
			outline-offset: 2px;
			border-radius: 4px;
		}

		.xb-sync-button {
			box-sizing: border-box;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			height: 30px;
			min-width: 9ch;
			padding: 0 10px;
			border: 1px solid var(--xb-border);
			border-radius: 8px;
			background: transparent;
			color: var(--xb-ink);
			font: inherit;
			font-size: 12px;
			font-weight: 600;
			cursor: pointer;
			white-space: nowrap;
			transition: transform 160ms var(--xb-ease-out), background-color 150ms ease, opacity 150ms ease;
		}

		.xb-sync-button:disabled {
			opacity: 0.45;
			cursor: default;
		}

		.xb-sync-button:active {
			transform: scale(0.96);
		}

		.xb-sync-button:focus-visible {
			outline: 2px solid var(--xb-primary);
			outline-offset: 2px;
		}

		.xb-spin {
			animation: xb-spin 0.8s linear infinite;
		}

		@keyframes xb-spin {
			from { transform: rotate(0deg); }
			to { transform: rotate(360deg); }
		}

		@media (hover: hover) and (pointer: fine) {
			.xb-sync-button:not(:disabled):hover { background: var(--xb-track); }
			.xb-ghost-link:hover { color: var(--xb-ink); }
			.xb-footer-button:hover { background: var(--xb-elevated); }
		}

		.xb-footer {
			margin-top: 8px;
		}

		.xb-footer-button {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			justify-content: space-between;
			width: 100%;
			height: 40px;
			padding: 0 4px;
			border: 0;
			border-radius: 8px;
			background: transparent;
			color: var(--xb-ink);
			font: inherit;
			font-size: 13px;
			font-weight: 600;
			cursor: pointer;
			transition: background-color 150ms ease, transform 160ms var(--xb-ease-out);
		}

		.xb-footer-button:active {
			transform: scale(0.98);
		}

		.xb-footer-button:focus-visible {
			outline: 2px solid var(--xb-primary);
			outline-offset: 2px;
		}

		.xb-footer-chevron {
			color: var(--xb-ink-muted);
			font-size: 15px;
			line-height: 1;
		}

		@media (prefers-reduced-motion: reduce) {
			.xb-popup, .xb-popup *, .xb-popup *::before, .xb-popup *::after {
				animation-duration: 0.01ms !important;
				animation-iteration-count: 1 !important;
				transition-property: opacity !important;
				transition-duration: 120ms !important;
			}
			.xb-telltale[data-state="syncing"] {
				animation: none !important;
				opacity: 0.7 !important;
			}
		}
	`;
  document.head.appendChild(style);
}

function buildHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "xb-region xb-header";

  const brand = document.createElement("div");
  brand.className = "xb-brand";

  const mark = document.createElement("span");
  mark.className = "xb-brand-mark";
  mark.appendChild(createIcon("shield", 14));

  const title = document.createElement("h1");
  title.textContent = "XBlocker";

  brand.append(mark, title);

  const status = document.createElement("div");
  status.className = "xb-status";

  const dot = document.createElement("span");
  dot.className = "xb-status-dot";
  dot.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  // Always true today (there is no per-tab/enabled-state signal yet) so the copy says
  // what the extension DOES rather than implying a toggle-able "on/off" the popup can't
  // actually observe.
  label.textContent = "Protecting x.com";

  status.append(dot, label);
  header.append(brand, status);
  return header;
}

function buildStatCell(
  label: string,
  tone: "danger" | "success" | "warning",
  clock: Partial<LiveNumberClock> | undefined,
): {
  element: HTMLElement;
  live: LiveNumber;
} {
  const cell = document.createElement("div");
  cell.className = "xb-stat-cell";
  cell.setAttribute("role", "group");
  cell.setAttribute("aria-label", label);

  const value = document.createElement("span");
  value.className = "xb-stat-value";
  cell.appendChild(value);
  const live = createLiveNumber(value, clock ? { clock } : {});

  const tick = document.createElement("span");
  tick.className = "xb-stat-tick";
  tick.dataset.tone = tone;
  cell.appendChild(tick);

  const labelNode = document.createElement("span");
  labelNode.className = "xb-stat-label";
  labelNode.textContent = label;
  cell.appendChild(labelNode);

  return { element: cell, live };
}

function buildStatStrip(clock: Partial<LiveNumberClock> | undefined): {
  element: HTMLElement;
  blockedLive: LiveNumber;
  mutedLive: LiveNumber;
  whitelistLive: LiveNumber;
} {
  const strip = document.createElement("div");
  strip.className = "xb-region xb-stat-strip";

  const blocked = buildStatCell("Blocked", "danger", clock);
  const muted = buildStatCell("Muted", "warning", clock);
  const whitelisted = buildStatCell("Whitelisted", "success", clock);
  strip.append(blocked.element, muted.element, whitelisted.element);

  return {
    element: strip,
    blockedLive: blocked.live,
    mutedLive: muted.live,
    whitelistLive: whitelisted.live,
  };
}

function buildToggleRow(
  label: string,
  caption: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "xb-toggle-row";

  const copy = document.createElement("span");
  copy.className = "xb-toggle-copy";

  const title = document.createElement("span");
  title.className = "xb-toggle-title";
  title.textContent = label;

  const captionNode = document.createElement("span");
  captionNode.className = "xb-toggle-caption";
  captionNode.textContent = caption;

  copy.append(title, captionNode);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "xb-switch";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));

  row.append(copy, input);
  return row;
}

function buildToggles(settings: Settings): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "xb-region xb-toggles";

  wrap.appendChild(
    buildToggleRow(
      "Protect whitelist",
      "Whitelisted handles are skipped during bulk actions.",
      settings.protectWhitelist,
      (checked) => {
        settings.protectWhitelist = checked;
        saveSettings(settings);
      },
    ),
  );

  wrap.appendChild(
    buildToggleRow(
      "Confirm destructive actions",
      "Ask before removing whitelist entries.",
      settings.confirmDestructiveActions,
      (checked) => {
        settings.confirmDestructiveActions = checked;
        saveSettings(settings);
      },
    ),
  );

  return wrap;
}

export type SyncRowState = "error" | "idle" | "off" | "syncing" | "unconfigured";

function syncRowCopy(state: SyncRowState, idleDetail: string): { title: string; detail: string } {
  switch (state) {
    case "unconfigured":
      return { title: "Cloud backup", detail: "Not configured for this build." };
    case "off":
      return { title: "Backup off", detail: "Turn on in settings." };
    case "syncing":
      return { title: "Backup on", detail: "Syncing…" };
    case "error":
      return { title: "Backup on", detail: "Sync failed. Tap retry." };
    default:
      return { title: "Backup on", detail: idleDetail };
  }
}

type SyncRowHandles = {
  element: HTMLElement;
  setState(state: SyncRowState, idleDetail: string): void;
};

/**
 * The sync row has no toggle of its own (enabling cloud backup lives on the settings
 * page) — it only ever shows a status + the ONE action that is actually available:
 * "Sync now" when backup is on, a link to settings when it's off, or plain text when
 * the build has no Convex URL at all. `trigger` is a mutable box so the row can be
 * built before its click handler (which needs the not-yet-created guarded-sync
 * function) exists — renderPopup fills in `trigger.run` right after construction, before
 * the row is ever interactive, so `run` starts `undefined` rather than a placeholder
 * that would never actually run.
 */
function buildSyncRow(trigger: { run?: () => void }): SyncRowHandles {
  const row = document.createElement("div");
  row.className = "xb-region xb-sync-row";

  const left = document.createElement("div");
  left.className = "xb-sync-left";

  const dot = document.createElement("span");
  dot.className = "xb-telltale";
  dot.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  copy.className = "xb-sync-copy";
  // Screen-reader feedback for syncing/success/error transitions — the telltale dot
  // itself stays aria-hidden, so this text is the only accessible signal.
  copy.setAttribute("aria-live", "polite");
  copy.setAttribute("aria-atomic", "true");
  const title = document.createElement("span");
  title.className = "xb-sync-title";
  const detail = document.createElement("span");
  detail.className = "xb-sync-detail";
  copy.append(title, detail);

  left.append(dot, copy);

  const action = document.createElement("div");
  action.className = "xb-sync-action";

  row.append(left, action);

  function renderAction(state: SyncRowState): void {
    action.replaceChildren();

    if (state === "unconfigured") {
      const note = document.createElement("span");
      note.className = "xb-sync-note";
      note.textContent = "Not configured";
      action.appendChild(note);
      return;
    }

    if (state === "off") {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "xb-ghost-link";
      link.textContent = "Turn on in settings";
      link.addEventListener("click", openSettings);
      action.appendChild(link);
      return;
    }

    // idle | syncing | error: the one available action is (re)running a sync.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xb-sync-button";
    const busy = state === "syncing";
    button.disabled = busy;
    if (busy) {
      button.appendChild(createIcon("loading", 12));
    }
    const buttonLabel = document.createElement("span");
    buttonLabel.textContent = busy ? "Syncing…" : "Sync now";
    button.appendChild(buttonLabel);
    button.addEventListener("click", () => trigger.run?.());
    action.appendChild(button);
  }

  function setState(state: SyncRowState, idleDetail: string): void {
    dot.dataset.state = state;
    const rowCopy = syncRowCopy(state, idleDetail);
    title.textContent = rowCopy.title;
    detail.textContent = rowCopy.detail;
    renderAction(state);
  }

  return { element: row, setState };
}

function buildFooter(): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "xb-footer";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "xb-footer-button";

  const label = document.createElement("span");
  label.textContent = "Open settings";

  const chevron = document.createElement("span");
  chevron.className = "xb-footer-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";

  button.append(label, chevron);
  button.addEventListener("click", openSettings);

  footer.appendChild(button);
  return footer;
}

export type RenderPopupOptions = Pick<CloudSyncDeps, "loadAdapter" | "now" | "probeConfigured"> & {
  /**
   * Test-only seam: inject a deterministic clock for the stat strip's live-number
   * primitive so a storage-driven delta (see the `blockedStore.onChange` wiring below)
   * can be driven through its 100ms debounce + 180ms animation synchronously in tests
   * instead of depending on real timers/rAF. Production callers (mountPopupIfPresent)
   * never pass this, so the popup always animates on the real clock.
   */
  clock?: Partial<LiveNumberClock>;
};

export async function renderPopup(root: HTMLElement, opts: RenderPopupOptions = {}): Promise<void> {
  ensurePopupStyles();

  const [settings, whitelist, cloudBackupEnabled, stats] = await Promise.all([
    readSettings(),
    getWhitelist(),
    storageGet<boolean>(CLOUD_BACKUP_KEY).then((value) => value === true),
    blockedStore.stats(),
  ]);

  const popup = document.createElement("main");
  popup.className = "xb-popup";
  popup.dataset.xbSurface = "popup";

  const header = buildHeader();
  const statStrip = buildStatStrip(opts.clock);
  const toggles = buildToggles(settings);
  const syncTrigger: { run?: () => void } = {};
  const syncRow = buildSyncRow(syncTrigger);
  const syncSession = createCloudSyncSession(opts);
  const footer = buildFooter();

  popup.append(header, statStrip.element, toggles, syncRow.element, footer);
  root.replaceChildren(popup);

  // The first set() on a fresh createLiveNumber renders instantly with no debounce or
  // animation (see live-number.ts) — this is what keeps the popup's mount free of any
  // entrance animation even though it runs after the awaits above.
  statStrip.blockedLive.set(stats.blocked);
  statStrip.mutedLive.set(stats.muted);
  statStrip.whitelistLive.set(whitelist.length);

  blockedStore.onChange((next: BlockedStats) => {
    statStrip.blockedLive.set(next.blocked);
    statStrip.mutedLive.set(next.muted);
  });

  // Best guess before the port's configured-check below resolves: "off" needs no Convex
  // knowledge at all, and "idle" is the common case for an already-configured, already
  // enabled build. The session keeps the transport lazy.
  syncRow.setState(cloudBackupEnabled ? "idle" : "off", "Never synced.");

  const runManualSync = async (): Promise<void> => {
    if (syncSession.isInFlight()) return;
    syncRow.setState("syncing", "");
    try {
      const result = await syncSession.runManual();
      if (result) syncRow.setState(result.state, result.detail);
    } catch {
      syncRow.setState("error", "");
    }
  };
  syncTrigger.run = () => {
    void runManualSync();
  };

  void (async () => {
    if (!(await syncSession.isBuildConfigured())) {
      syncRow.setState("unconfigured", "");
      return;
    }
    if (!cloudBackupEnabled) {
      syncRow.setState("off", "");
      return;
    }
    const result = await syncSession.runAutoOnOpen(true, {
      onSyncStart: () => syncRow.setState("syncing", ""),
    });
    // Apply only a result this auto run actually owns: a "syncing" result means a manual
    // "Sync now" claimed the row (the session was busy or got superseded mid-gate), and a
    // settled-but-stale result must not land while a manual sync is still in flight —
    // either way the owner's telltale/copy would be clobbered (PU-CB-11).
    if (result.state !== "syncing" && !syncSession.isInFlight()) {
      syncRow.setState(result.state, result.detail);
    }
  })();
}

export function mountPopupIfPresent(opts: RenderPopupOptions = {}): void {
  const appRoot = document.getElementById("app");
  if (appRoot) {
    void renderPopup(appRoot, opts);
  }
}

mountPopupIfPresent();
