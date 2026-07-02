import type { BlockedStats } from "../lib/blocked-merge";
import { blockedStore } from "../lib/blocked-store";
import {
  clampMaxReplies,
  normalizeUsername,
  DEFAULT_MAX_REPLIES,
  MAX_REPLIES_LIMIT,
} from "../lib/settings";
import { getSyncMeta, runCloudSync, shouldAutoSync, type SyncMeta } from "../lib/sync-engine";

type PopupSettings = {
  confirmDestructiveActions: boolean;
  keyboardMode: boolean;
  maxReplies: number;
  protectWhitelist: boolean;
};

type BooleanSettingKey = "confirmDestructiveActions" | "keyboardMode" | "protectWhitelist";

type PopupState = {
  settings: PopupSettings;
  whitelist: string[];
  // Cloud backup opt-in lives under its own storage key, separate from the behavior
  // settings object, so toggling it never rewrites unrelated settings.
  cloudBackup: boolean;
};

const DEFAULT_SETTINGS: PopupSettings = {
  confirmDestructiveActions: true,
  keyboardMode: false,
  maxReplies: DEFAULT_MAX_REPLIES,
  protectWhitelist: true,
};

function getStoredState(): Promise<PopupState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings", "whitelist", "cloudBackup"], (result) => {
      const storedSettings =
        typeof result?.settings === "object" && result.settings ? result.settings : {};
      const settings = { ...DEFAULT_SETTINGS, ...storedSettings };
      settings.maxReplies = clampMaxReplies(settings.maxReplies);
      const whitelist = Array.isArray(result?.whitelist) ? result.whitelist : [];
      const cloudBackup = result?.cloudBackup === true;
      resolve({ settings, whitelist, cloudBackup });
    });
  });
}

function saveSettings(settings: PopupSettings): void {
  void chrome.storage.local.set({ settings });
}

function saveWhitelist(whitelist: string[]): void {
  void chrome.storage.local.set({ whitelist });
}

function saveCloudBackup(enabled: boolean): void {
  void chrome.storage.local.set({ cloudBackup: enabled });
}

function ensurePopupStyles(): void {
  if (document.getElementById("xblocker-popup-styles")) return;

  const style = document.createElement("style");
  style.id = "xblocker-popup-styles";
  style.textContent = `
		:root {
			color-scheme: dark;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background: #050607;
			color: #e7e9ea;
		}

		body {
			width: 360px;
			min-height: 540px;
			margin: 0;
			background: #050607;
		}

		.xb-popup {
			box-sizing: border-box;
			width: 360px;
			min-height: 540px;
			padding: 14px;
			background: linear-gradient(180deg, #111418 0%, #050607 34%);
			color: #e7e9ea;
		}

		.xb-popup-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding-bottom: 12px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		}

		.xb-brand {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
		}

		.xb-brand-mark {
			display: grid;
			place-items: center;
			width: 34px;
			height: 34px;
			border-radius: 8px;
			border: 1px solid rgba(142, 205, 248, 0.5);
			background: rgba(29, 155, 240, 0.14);
			color: #8ecdf8;
			font-size: 18px;
			font-weight: 800;
			line-height: 1;
		}

		.xb-brand-copy {
			display: grid;
			gap: 3px;
			min-width: 0;
		}

		.xb-popup h1 {
			margin: 0;
			font-size: 18px;
			line-height: 1.2;
			font-weight: 750;
			letter-spacing: 0;
		}

		.xb-status {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			color: #8b98a5;
			font-size: 12px;
			font-weight: 700;
			white-space: nowrap;
		}

		.xb-status::before {
			content: "";
			width: 7px;
			height: 7px;
			border-radius: 50%;
			background: #00ba7c;
		}

		.xb-header-settings {
			display: grid;
			place-items: center;
			width: 32px;
			height: 32px;
			border: 1px solid rgba(255, 255, 255, 0.12);
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.04);
			color: #8b98a5;
			cursor: pointer;
			font: inherit;
			font-size: 17px;
		}

		.xb-popup-section {
			margin-top: 12px;
			padding: 12px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.035);
		}

		.xb-section-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 10px;
		}

		.xb-popup-section h2 {
			margin: 0;
			color: #f7f9f9;
			font-size: 13px;
			line-height: 1.2;
			font-weight: 750;
			letter-spacing: 0;
		}

		.xb-section-note {
			color: #8b98a5;
			font-size: 12px;
			font-weight: 700;
			white-space: nowrap;
		}

		.xb-settings-list,
		.xb-whitelist-list {
			display: grid;
			gap: 8px;
		}

		.xb-toggle-row,
		.xb-whitelist-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			min-height: 34px;
			color: #d7dbdc;
			font-size: 13px;
			line-height: 1.2;
		}

		.xb-action-summary {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 8px;
		}

		.xb-summary-card {
			box-sizing: border-box;
			min-width: 0;
			padding: 10px 8px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			background: rgba(0, 0, 0, 0.16);
			text-align: center;
		}

		.xb-card-icon {
			display: inline-grid;
			place-items: center;
			width: 24px;
			height: 24px;
			margin-bottom: 6px;
			border-radius: 8px;
			font-size: 12px;
			font-weight: 850;
		}

		.xb-summary-card[data-tone="danger"] .xb-card-icon {
			background: rgba(244, 33, 46, 0.12);
			color: #ff6b73;
		}

		.xb-summary-card[data-tone="warning"] .xb-card-icon {
			background: rgba(255, 173, 31, 0.12);
			color: #ffcc66;
		}

		.xb-summary-card[data-tone="success"] .xb-card-icon {
			background: rgba(0, 186, 124, 0.12);
			color: #54d69d;
		}

		.xb-card-value {
			display: block;
			color: #f7f9f9;
			font-size: 19px;
			line-height: 1;
			font-weight: 850;
		}

		.xb-card-label {
			display: block;
			margin-top: 4px;
			color: #b5bdc4;
			font-size: 11px;
			font-weight: 700;
		}

		.xb-whitelist-form {
			display: flex;
			gap: 8px;
			margin-bottom: 10px;
		}

		.xb-whitelist-input {
			flex: 1;
			box-sizing: border-box;
			height: 36px;
			min-width: 0;
			border: 1px solid rgba(255, 255, 255, 0.12);
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.06);
			color: #e7e9ea;
			padding: 0 10px;
			font: inherit;
			font-size: 13px;
			outline: none;
		}

		.xb-whitelist-input:focus {
			border-color: #00ba7c;
		}

		.xb-button {
			height: 36px;
			border: 1px solid rgba(0, 186, 124, 0.58);
			border-radius: 8px;
			background: #00ba7c;
			color: white;
			padding: 0 12px;
			font: inherit;
			font-size: 13px;
			font-weight: 750;
			cursor: pointer;
			white-space: nowrap;
		}

		.xb-toggle-row {
			min-height: 48px;
			padding: 8px 0;
			border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		}

		.xb-toggle-row:last-child {
			border-bottom: 0;
		}

		.xb-toggle-copy {
			display: grid;
			gap: 3px;
			min-width: 0;
		}

		.xb-toggle-title {
			color: #e7e9ea;
			font-size: 13px;
			font-weight: 700;
		}

		.xb-toggle-description {
			color: #8b98a5;
			font-size: 11px;
			line-height: 1.25;
		}

		.xb-switch-input,
		.xb-cloud-switch {
			appearance: none;
			position: relative;
			flex: 0 0 auto;
			width: 42px;
			height: 24px;
			margin: 0;
			border-radius: 999px;
			border: 1px solid rgba(255, 255, 255, 0.16);
			background: #2f3336;
			cursor: pointer;
			transition: background 0.16s ease, border-color 0.16s ease;
		}

		.xb-switch-input::before,
		.xb-cloud-switch::before {
			content: "";
			position: absolute;
			top: 3px;
			left: 3px;
			width: 16px;
			height: 16px;
			border-radius: 50%;
			background: #d7dbdc;
			transition: transform 0.16s ease, background 0.16s ease;
		}

		.xb-switch-input:checked,
		.xb-cloud-switch:checked {
			border-color: rgba(29, 155, 240, 0.75);
			background: #1d9bf0;
		}

		.xb-switch-input:checked::before,
		.xb-cloud-switch:checked::before {
			background: white;
			transform: translateX(18px);
		}

		.xb-cloud-controls {
			display: flex;
			gap: 8px;
			margin-top: 10px;
		}

		.xb-number-input {
			box-sizing: border-box;
			flex: 0 0 auto;
			width: 64px;
			height: 30px;
			border: 1px solid rgba(255, 255, 255, 0.12);
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.06);
			color: #e7e9ea;
			padding: 0 8px;
			font: inherit;
			font-size: 13px;
			text-align: right;
			outline: none;
		}

		.xb-number-input:focus {
			border-color: #1d9bf0;
		}

		.xb-whitelist-row {
			min-height: 38px;
			padding: 0 0 8px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		}

		.xb-whitelist-row:last-child {
			border-bottom: 0;
			padding-bottom: 0;
		}

		.xb-whitelist-handle {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}

		.xb-avatar {
			display: grid;
			place-items: center;
			width: 28px;
			height: 28px;
			border-radius: 50%;
			background: rgba(29, 155, 240, 0.18);
			color: #8ecdf8;
			font-size: 11px;
			font-weight: 850;
			text-transform: uppercase;
		}

		.xb-whitelist-name {
			color: #d7dbdc;
			font-weight: 650;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.xb-remove-button,
		.xb-link-button {
			border: 0;
			background: transparent;
			color: #8b98a5;
			font: inherit;
			font-size: 12px;
			font-weight: 700;
			cursor: pointer;
			padding: 4px 0;
		}

		.xb-remove-button:hover,
		.xb-link-button:hover {
			color: #e7e9ea;
		}

		.xb-popup-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-top: 12px;
			padding: 10px 12px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.035);
		}
	`;
  document.head.appendChild(style);
}

function createSection(title: string, note?: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "xb-popup-section";

  const header = document.createElement("div");
  header.className = "xb-section-header";

  const heading = document.createElement("h2");
  heading.textContent = title;
  header.appendChild(heading);

  if (note) {
    const noteNode = document.createElement("span");
    noteNode.className = "xb-section-note";
    noteNode.textContent = note;
    header.appendChild(noteNode);
  }

  section.appendChild(header);

  return section;
}

type SummaryHandles = {
  updateStats(stats: BlockedStats): void;
  updateWhitelist(count: number): void;
};

function renderActionSummary(
  section: HTMLElement,
  state: PopupState,
  stats: BlockedStats,
): SummaryHandles {
  const list = document.createElement("div");
  list.className = "xb-action-summary";

  const summaryRows: Array<[string, string, string, string]> = [
    ["Block replies", String(stats.blocked), "Blocked", "danger"],
    ["Mute replies", String(stats.muted), "Muted", "warning"],
    ["Whitelist", String(state.whitelist.length), "Whitelisted", "success"],
  ];

  const valueNodes: HTMLSpanElement[] = [];
  for (const [label, value, caption, tone] of summaryRows) {
    const card = document.createElement("div");
    card.className = "xb-summary-card";
    card.dataset.tone = tone;
    card.setAttribute("aria-label", label);

    const icon = document.createElement("span");
    icon.className = "xb-card-icon";
    icon.textContent = label.slice(0, 1);

    const valueNode = document.createElement("span");
    valueNode.className = "xb-card-value";
    valueNode.textContent = value;
    valueNodes.push(valueNode);

    const labelNode = document.createElement("span");
    labelNode.className = "xb-card-label";
    labelNode.textContent = caption;

    const actionName = document.createElement("span");
    actionName.hidden = true;
    actionName.textContent = label;

    card.append(icon, valueNode, labelNode, actionName);
    list.appendChild(card);
  }

  section.appendChild(list);
  const [blockedNode, mutedNode, whitelistNode] = valueNodes;
  return {
    updateStats(next) {
      if (blockedNode) blockedNode.textContent = String(next.blocked);
      if (mutedNode) mutedNode.textContent = String(next.muted);
    },
    updateWhitelist(count) {
      if (whitelistNode) whitelistNode.textContent = String(count);
    },
  };
}

function renderWhitelist(
  section: HTMLElement,
  state: PopupState,
  onCountChange: (count: number) => void,
): void {
  const form = document.createElement("form");
  form.className = "xb-whitelist-form";

  const input = document.createElement("input");
  input.className = "xb-whitelist-input";
  input.placeholder = "Add username";
  input.autocomplete = "off";

  const addButton = document.createElement("button");
  addButton.className = "xb-button";
  addButton.type = "submit";
  addButton.textContent = "Add";

  form.append(input, addButton);

  const list = document.createElement("div");
  list.className = "xb-whitelist-list";

  const drawList = () => {
    list.replaceChildren();
    for (const username of state.whitelist) {
      const row = document.createElement("div");
      row.className = "xb-whitelist-row";

      const handle = document.createElement("div");
      handle.className = "xb-whitelist-handle";

      const avatar = document.createElement("span");
      avatar.className = "xb-avatar";
      avatar.textContent = username.slice(0, 2);

      const handleName = document.createElement("span");
      handleName.className = "xb-whitelist-name";
      handleName.textContent = `@${username}`;
      handle.append(avatar, handleName);

      const removeButton = document.createElement("button");
      removeButton.className = "xb-remove-button";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        state.whitelist = state.whitelist.filter((item) => item !== username);
        saveWhitelist(state.whitelist);
        drawList();
        onCountChange(state.whitelist.length);
      });

      row.append(handle, removeButton);
      list.appendChild(row);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = normalizeUsername(input.value);
    if (!username || state.whitelist.includes(username)) return;

    state.whitelist = [...state.whitelist, username];
    saveWhitelist(state.whitelist);
    input.value = "";
    drawList();
    onCountChange(state.whitelist.length);
  });

  drawList();
  section.append(form, list);
}

function renderSettings(section: HTMLElement, settings: PopupSettings): void {
  const list = document.createElement("div");
  list.className = "xb-settings-list";

  const rows: Array<[BooleanSettingKey, string, string]> = [
    ["protectWhitelist", "Protect whitelist", "Block and mute skip trusted handles"],
    ["confirmDestructiveActions", "Confirm destructive actions", "Ask before irreversible actions"],
    ["keyboardMode", "Keyboard mode", "Reserved for future j/k reply navigation"],
  ];

  for (const [key, label, description] of rows) {
    const row = document.createElement("label");
    row.className = "xb-toggle-row";

    const copy = document.createElement("span");
    copy.className = "xb-toggle-copy";

    const labelNode = document.createElement("span");
    labelNode.className = "xb-toggle-title";
    labelNode.textContent = label;

    const descriptionNode = document.createElement("span");
    descriptionNode.className = "xb-toggle-description";
    descriptionNode.textContent = description;
    copy.append(labelNode, descriptionNode);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "xb-switch-input";
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings[key] = input.checked;
      saveSettings(settings);
    });

    row.append(copy, input);
    list.appendChild(row);
  }

  const maxRepliesRow = document.createElement("label");
  maxRepliesRow.className = "xb-toggle-row";

  const maxRepliesCopy = document.createElement("span");
  maxRepliesCopy.className = "xb-toggle-copy";

  const maxRepliesTitle = document.createElement("span");
  maxRepliesTitle.className = "xb-toggle-title";
  maxRepliesTitle.textContent = "Max replies per run";

  const maxRepliesDescription = document.createElement("span");
  maxRepliesDescription.className = "xb-toggle-description";
  maxRepliesDescription.textContent = `Replies Block and Mute process at once (1–${MAX_REPLIES_LIMIT})`;
  maxRepliesCopy.append(maxRepliesTitle, maxRepliesDescription);

  const maxRepliesInput = document.createElement("input");
  maxRepliesInput.type = "number";
  maxRepliesInput.className = "xb-number-input";
  maxRepliesInput.min = "1";
  maxRepliesInput.max = String(MAX_REPLIES_LIMIT);
  maxRepliesInput.value = String(settings.maxReplies);
  maxRepliesInput.setAttribute("aria-label", "Max replies per run");
  // Persist while typing: the popup can close before "change" fires, which
  // would silently drop the edit. Readers re-normalize, so saving each
  // keystroke is safe; "change" then snaps the visible value into range.
  maxRepliesInput.addEventListener("input", () => {
    settings.maxReplies = clampMaxReplies(maxRepliesInput.value);
    saveSettings(settings);
  });
  maxRepliesInput.addEventListener("change", () => {
    const maxReplies = clampMaxReplies(maxRepliesInput.value);
    maxRepliesInput.value = String(maxReplies);
    settings.maxReplies = maxReplies;
    saveSettings(settings);
  });

  maxRepliesRow.append(maxRepliesCopy, maxRepliesInput);
  list.appendChild(maxRepliesRow);

  section.appendChild(list);
}

/** Human "how long ago" for the cloud status line; coarse on purpose. */
export function formatLastSync(meta: SyncMeta, now: number): string {
  const at = meta.lastSyncAt;
  if (typeof at !== "number") return "never synced";
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 1) return "synced just now";
  if (mins < 60) return `synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  return `synced ${Math.round(hours / 24)}d ago`;
}

/** The cloud section's resting status: opt-in state and last sync age. (Anything
 *  pending triggers an auto-sync on open instead of resting here.) */
async function composeIdleStatus(enabled: boolean): Promise<string> {
  if (!enabled) {
    return "Off. Your blocked list stays on this device only.";
  }
  const meta = await getSyncMeta();
  return `Backup on · ${formatLastSync(meta, Date.now())}.`;
}

// Drive a one-shot cloud sync via the shared engine (lib/sync-engine): drain the local
// outbox in batched round-trips, then pull and merge remote accounts. The Convex bundle
// stays lazy — the engine imports it only when a sync actually runs.
async function syncCloud(setStatus: (message: string) => void): Promise<void> {
  setStatus("Syncing…");
  const outcome = await runCloudSync();
  if (outcome.status === "unconfigured") {
    setStatus("Not configured. Set VITE_CONVEX_URL, then rebuild.");
    return;
  }
  setStatus(`Backed up to your Convex.${outcome.pushed > 0 ? ` Pushed ${outcome.pushed}.` : ""}`);
}

type CloudSectionHandles = {
  setStatus: (message: string) => void;
  refreshIdleStatus: () => Promise<void>;
};

function renderCloudBackup(section: HTMLElement, enabled: boolean): CloudSectionHandles {
  const status = document.createElement("p");
  status.className = "xb-toggle-description";
  status.textContent = enabled ? "Backup on." : "Off. Your blocked list stays on this device only.";

  const setStatus = (message: string) => {
    status.textContent = message;
  };

  const toggleRow = document.createElement("label");
  toggleRow.className = "xb-toggle-row";

  const copy = document.createElement("span");
  copy.className = "xb-toggle-copy";
  const title = document.createElement("span");
  title.className = "xb-toggle-title";
  title.textContent = "Back up blocked list to cloud";
  const description = document.createElement("span");
  description.className = "xb-toggle-description";
  description.textContent = "Mirror your blocked accounts to your Convex (opt-in)";
  copy.append(title, description);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "xb-cloud-switch";
  toggle.checked = enabled;
  const refreshIdleStatus = async () => {
    setStatus(await composeIdleStatus(toggle.checked));
  };
  toggle.addEventListener("change", () => {
    saveCloudBackup(toggle.checked);
    if (toggle.checked) {
      void syncCloud(setStatus).catch((error: unknown) => {
        setStatus(`Backup error: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      void refreshIdleStatus();
    }
  });
  toggleRow.append(copy, toggle);

  const controls = document.createElement("div");
  controls.className = "xb-cloud-controls";

  const syncButton = document.createElement("button");
  syncButton.type = "button";
  syncButton.className = "xb-button";
  syncButton.textContent = "Sync now";

  syncButton.addEventListener("click", async () => {
    syncButton.disabled = true;
    try {
      await syncCloud(setStatus);
    } catch (error: unknown) {
      setStatus(`Backup error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      syncButton.disabled = false;
    }
  });

  controls.append(syncButton);
  section.append(toggleRow, controls, status);

  return { setStatus, refreshIdleStatus };
}

export async function renderPopup(root: HTMLElement): Promise<void> {
  ensurePopupStyles();
  const [state, stats] = await Promise.all([getStoredState(), blockedStore.stats()]);

  const popup = document.createElement("main");
  popup.className = "xb-popup";
  popup.dataset.xbSurface = "popup";

  const header = document.createElement("header");
  header.className = "xb-popup-header";

  const brand = document.createElement("div");
  brand.className = "xb-brand";

  const brandMark = document.createElement("div");
  brandMark.className = "xb-brand-mark";
  brandMark.textContent = "X";

  const brandCopy = document.createElement("div");
  brandCopy.className = "xb-brand-copy";

  const title = document.createElement("h1");
  title.textContent = "XBlocker";

  const status = document.createElement("div");
  status.className = "xb-status";
  status.textContent = "Active on x.com";

  brandCopy.append(title, status);
  brand.append(brandMark, brandCopy);

  const headerSettings = document.createElement("button");
  headerSettings.type = "button";
  headerSettings.className = "xb-header-settings";
  headerSettings.setAttribute("aria-label", "Advanced settings");
  headerSettings.textContent = "*";

  header.append(brand, headerSettings);

  const summarySection = createSection("Quick actions");
  const summary = renderActionSummary(summarySection, state, stats);
  // Live counters: a block recorded by the content script while the popup is open
  // shows up here without a reopen.
  blockedStore.onChange((next) => {
    summary.updateStats(next);
  });

  const whitelistSection = createSection("Whitelist", `${state.whitelist.length} saved`);
  const whitelistNote = whitelistSection.querySelector(".xb-section-note");
  renderWhitelist(whitelistSection, state, (count) => {
    summary.updateWhitelist(count);
    if (whitelistNote) whitelistNote.textContent = `${count} saved`;
  });

  const settingsSection = createSection("Behavior settings");
  renderSettings(settingsSection, state.settings);

  const cloudSection = createSection("Cloud backup");
  const cloud = renderCloudBackup(cloudSection, state.cloudBackup);

  const footer = document.createElement("footer");
  footer.className = "xb-popup-footer";

  const advancedButton = document.createElement("button");
  advancedButton.type = "button";
  advancedButton.className = "xb-link-button";
  advancedButton.textContent = "Advanced settings";
  const footerHint = document.createElement("span");
  footerHint.className = "xb-section-note";
  footerHint.textContent = "More controls";
  footer.append(footerHint, advancedButton);

  popup.append(header, summarySection, whitelistSection, settingsSection, cloudSection, footer);
  root.replaceChildren(popup);

  // Freshness on open: when backup is on and there is queued work (or the last pull is
  // stale), sync right away so the status/state the user sees is current — otherwise
  // just show the resting status (pending count + last sync age).
  if (state.cloudBackup) {
    void (async () => {
      const [pending, meta] = await Promise.all([blockedStore.pending(), getSyncMeta()]);
      if (shouldAutoSync(true, pending.length, meta, Date.now())) {
        await syncCloud(cloud.setStatus);
      } else {
        await cloud.refreshIdleStatus();
      }
    })().catch((error: unknown) => {
      cloud.setStatus(`Backup error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

export function mountPopupIfPresent(): void {
  const appRoot = document.getElementById("app");
  if (appRoot) {
    void renderPopup(appRoot);
  }
}

mountPopupIfPresent();
