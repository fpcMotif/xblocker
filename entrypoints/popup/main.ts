// Gauge & Ledger popup: a lean status strip (see
// docs/plans/2026-07-10-gauge-and-ledger/plan.md, "Popup"). Whitelist management and
// max-replies now live on the settings page; this surface only shows the stat strip,
// two behavior toggles, the cloud sync row, and a link out to settings.
import * as stylex from "@stylexjs/stylex";
import type { BlockedStats } from "../../packages/storage/blocked-merge";
import { blockedStore } from "../../packages/storage/blocked-store";
import { popupStyles as styles } from "./popup.stylex";
import {
  CLOUD_BACKUP_KEY,
  SETTINGS_KEY,
  storageGet,
  storageSet,
} from "../../packages/storage/chrome-storage";
import { createCloudSyncSession, type CloudSyncDeps } from "../../packages/sync/cloud-session";
import { XB_FONT_STACK } from "../lib/design-tokens";
import { createIcon } from "../lib/icons";
import { createLiveNumber, type LiveNumber, type LiveNumberClock } from "../lib/live-number";
import { readSettings, type Settings } from "../../packages/storage/settings";
import { getWhitelist } from "../../packages/storage/whitelist-store";

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
		:root {
			color-scheme: light dark;
		}

		body {
			width: 360px;
			margin: 0;
			font-family: ${XB_FONT_STACK};
			-webkit-font-smoothing: antialiased;
		}


		.xb-switch::before {
			content: "";
			position: absolute;
			top: 2px;
			left: 2px;
			width: 14px;
			height: 14px;
			border-radius: 50%;
			background: oklch(1 0 0);
			transition: transform 160ms var(--xb-ease-out);
		}

		.xb-switch:checked { background: var(--xb-primary); border-color: var(--xb-primary); }
		.xb-switch:checked::before { transform: translateX(16px); }

		.xb-sync-button {
			min-width: 9ch;
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
  header.className = `${stylex.props(styles.header).className} xb-region xb-header`;

  const brand = document.createElement("div");
  brand.className = `${stylex.props(styles.brand).className} xb-brand`;

  const mark = document.createElement("span");
  mark.className = `${stylex.props(styles.brandMark).className} xb-brand-mark`;
  mark.appendChild(createIcon("shield", 14));

  const title = document.createElement("h1");
  title.className = `${stylex.props(styles.title).className}`;
  title.textContent = "XBlocker";

  brand.append(mark, title);

  const status = document.createElement("div");
  status.className = `${stylex.props(styles.status).className} xb-status`;

  const dot = document.createElement("span");
  dot.className = `${stylex.props(styles.statusDot).className} xb-status-dot`;
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
  cell.className = `${stylex.props(styles.statCell).className} xb-stat-cell`;
  cell.setAttribute("role", "group");
  cell.setAttribute("aria-label", label);

  const value = document.createElement("span");
  value.className = `${stylex.props(styles.statValue).className} xb-stat-value`;
  cell.appendChild(value);
  const live = createLiveNumber(value, clock ? { clock } : {});

  const tick = document.createElement("span");
  tick.className = `${stylex.props(styles.statTick, tone === "danger" ? styles.statTickDanger : tone === "warning" ? styles.statTickWarning : styles.statTickSuccess).className} xb-stat-tick`;
  tick.dataset.tone = tone;
  cell.appendChild(tick);

  const labelNode = document.createElement("span");
  labelNode.className = `${stylex.props(styles.statLabel).className} xb-stat-label`;
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
  strip.className = `${stylex.props(styles.regionBorder, styles.statStrip).className} xb-region xb-stat-strip`;

  const blocked = buildStatCell("Blocked", "danger", clock);
  blocked.element.classList.add(stylex.props(styles.statCellFirst).className!);
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
  row.className = `${stylex.props(styles.toggleRow).className} xb-toggle-row`;

  const copy = document.createElement("span");
  copy.className = `${stylex.props(styles.toggleCopy).className} xb-toggle-copy`;

  const title = document.createElement("span");
  title.className = `${stylex.props(styles.toggleTitle).className} xb-toggle-title`;
  title.textContent = label;

  const captionNode = document.createElement("span");
  captionNode.className = `${stylex.props(styles.toggleCaption).className} xb-toggle-caption`;
  captionNode.textContent = caption;

  copy.append(title, captionNode);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = `${stylex.props(styles.switchInput).className} xb-switch`;
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));

  row.append(copy, input);
  return row;
}

function buildToggles(settings: Settings): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `${stylex.props(styles.regionBorder, styles.toggles).className} xb-region xb-toggles`;
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
  row.className = `${stylex.props(styles.regionBorder, styles.syncRow).className} xb-region xb-sync-row`;

  const left = document.createElement("div");
  left.className = `${stylex.props(styles.syncLeft).className} xb-sync-left`;

  const dot = document.createElement("span");
  dot.className = `${stylex.props(styles.telltale).className} xb-telltale`;
  dot.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  copy.className = `${stylex.props(styles.syncCopy).className} xb-sync-copy`;
  // Screen-reader feedback for syncing/success/error transitions — the telltale dot
  // itself stays aria-hidden, so this text is the only accessible signal.
  copy.setAttribute("aria-live", "polite");
  copy.setAttribute("aria-atomic", "true");
  const title = document.createElement("span");
  title.className = `${stylex.props(styles.syncTitle).className} xb-sync-title`;
  const detail = document.createElement("span");
  detail.className = `${stylex.props(styles.syncDetail).className} xb-sync-detail`;
  copy.append(title, detail);

  left.append(dot, copy);

  const action = document.createElement("div");
  action.className = `${stylex.props(styles.syncAction).className} xb-sync-action`;

  row.append(left, action);

  function renderAction(state: SyncRowState): void {
    action.replaceChildren();

    if (state === "unconfigured") {
      const note = document.createElement("span");
      note.className = `${stylex.props(styles.syncNote).className} xb-sync-note`;
      note.textContent = "Not configured";
      action.appendChild(note);
      return;
    }

    if (state === "off") {
      const link = document.createElement("button");
      link.type = "button";
      link.className = `${stylex.props(styles.ghostLink).className} xb-ghost-link`;
      link.textContent = "Turn on in settings";
      link.addEventListener("click", openSettings);
      action.appendChild(link);
      return;
    }
    // idle | syncing | error: the one available action is (re)running a sync.
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${stylex.props(styles.syncButton).className} xb-sync-button`;
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
  footer.className = `${stylex.props(styles.regionBorder, styles.footer).className} xb-footer`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${stylex.props(styles.footerButton).className} xb-footer-button`;

  const label = document.createElement("span");
  label.textContent = "Open settings";

  const chevron = document.createElement("span");
  chevron.className = `${stylex.props(styles.footerChevron).className} xb-footer-chevron`;
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

  const popup = document.createElement("div");
  popup.className = `${stylex.props(styles.popup).className} xb-popup`;
  popup.dataset.xbSurface = "popup";

  const header = buildHeader();
  const main = document.createElement("main");
  main.className = `${stylex.props(styles.popupMain).className} xb-popup-main`;

  const statStrip = buildStatStrip(opts.clock);
  const toggles = buildToggles(settings);
  const syncTrigger: { run?: () => void } = {};
  const syncRow = buildSyncRow(syncTrigger);
  const syncSession = createCloudSyncSession(opts);
  const footer = buildFooter();

  main.append(statStrip.element, toggles, syncRow.element);
  popup.append(header, main, footer);
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
