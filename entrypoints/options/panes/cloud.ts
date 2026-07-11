// Cloud backup pane. convex-sync.ts is never statically imported (an unconfigured build
// should not pay for the Convex bundle at all) — both the "is this build configured"
// check and the wipe action reach it through a lazy import(), same discipline
// lib/sync-engine.ts already uses for push/pull.

import { blockedStore } from "../../lib/blocked-store";
import { CLOUD_BACKUP_KEY, storageGet, storageSet } from "../../lib/chrome-storage";
import { getSyncMeta, runCloudSync, SYNC_META_KEY, type SyncMeta } from "../../lib/sync-engine";

export const WIPE_CONFIRM_WORD = "WIPE";

async function loadConvexSync(): Promise<{
  isCloudConfigured: () => boolean;
  clearCloud: () => Promise<void>;
}> {
  return import("../../lib/convex-sync");
}

/** "Never synced." / "Synced just now." / "Synced 4m ago." — coarse, matching the popup's
 *  own phrasing but kept as a local, independent implementation (this pane must not
 *  depend on entrypoints/popup/main.ts, which is a different surface under active work). */
export function formatSyncAge(meta: SyncMeta, now: number): string {
  const at = meta.lastSyncAt;
  if (typeof at !== "number") return "Never synced.";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Synced just now.";
  if (minutes < 60) return `Synced ${minutes}m ago.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago.`;
  return `Synced ${Math.round(hours / 24)}d ago.`;
}

type PaneHandle = { destroy(): void };

function renderUnconfigured(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-pane-form";

  const header = document.createElement("div");
  header.className = "xb-opt-pane-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Cloud backup";
  const desc = document.createElement("p");
  desc.textContent = "Mirror your blocked list to your private Convex project.";
  header.append(h1, desc);

  const card = document.createElement("div");
  card.className = "xb-opt-empty";
  const title = document.createElement("p");
  title.textContent = "Cloud backup isn't configured for this build.";
  card.appendChild(title);

  wrapper.append(header, card);
  container.replaceChildren(wrapper);
}

export async function renderCloudPane(
  container: HTMLElement,
  opts: { now?: () => number } = {},
): Promise<PaneHandle> {
  const now = opts.now ?? Date.now;
  const { isCloudConfigured, clearCloud } = await loadConvexSync();

  if (!isCloudConfigured()) {
    renderUnconfigured(container);
    return { destroy() {} };
  }

  const [enabledStored, meta, pending] = await Promise.all([
    storageGet<boolean>(CLOUD_BACKUP_KEY),
    getSyncMeta(),
    blockedStore.pending(),
  ]);
  let enabled = enabledStored === true;

  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-pane-form";

  const header = document.createElement("div");
  header.className = "xb-opt-pane-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Cloud backup";
  const desc = document.createElement("p");
  desc.textContent = "Mirror your blocked list to your private Convex project.";
  header.append(h1, desc);

  const statusCard = document.createElement("div");
  statusCard.className = "xb-opt-card";

  const toggleRow = document.createElement("label");
  toggleRow.className = "xb-opt-row";
  const toggleCopy = document.createElement("span");
  toggleCopy.className = "xb-opt-row-copy";
  const toggleTitle = document.createElement("span");
  toggleTitle.className = "xb-opt-row-title";
  toggleTitle.textContent = "Back up blocked list to cloud";
  const toggleCaption = document.createElement("span");
  toggleCaption.className = "xb-opt-row-caption";
  toggleCaption.textContent = "Mirror your blocked accounts to your Convex project.";
  toggleCopy.append(toggleTitle, toggleCaption);
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.className = "xb-opt-switch";
  toggleInput.checked = enabled;
  toggleRow.append(toggleCopy, toggleInput);

  const statusRow = document.createElement("div");
  statusRow.className = "xb-opt-row xb-opt-row-meta";
  const statusLabel = document.createElement("span");
  statusLabel.className = "xb-opt-row-title";
  statusLabel.textContent = "Status";
  const statusValue = document.createElement("span");
  statusValue.className = "xb-opt-row-value";
  statusRow.append(statusLabel, statusValue);

  const lastSyncedRow = document.createElement("div");
  lastSyncedRow.className = "xb-opt-row xb-opt-row-meta";
  const lastSyncedLabel = document.createElement("span");
  lastSyncedLabel.className = "xb-opt-row-title";
  lastSyncedLabel.textContent = "Last synced";
  const lastSyncedValue = document.createElement("span");
  lastSyncedValue.className = "xb-opt-row-value";
  lastSyncedRow.append(lastSyncedLabel, lastSyncedValue);

  const pendingRow = document.createElement("div");
  pendingRow.className = "xb-opt-row xb-opt-row-meta";
  const pendingLabel = document.createElement("span");
  pendingLabel.className = "xb-opt-row-title";
  pendingLabel.textContent = "Pending actions";
  const pendingValue = document.createElement("span");
  pendingValue.className = "xb-opt-row-value";
  pendingRow.append(pendingLabel, pendingValue);

  const syncRow = document.createElement("div");
  syncRow.className = "xb-opt-row";
  const syncButton = document.createElement("button");
  syncButton.type = "button";
  syncButton.className = "xb-opt-btn";
  syncButton.dataset.variant = "secondary";
  syncButton.dataset.reserve = "true";
  syncButton.style.setProperty("--xb-opt-btn-reserve", "88px");
  syncButton.textContent = "Sync now";
  syncRow.append(syncButton);

  statusCard.append(toggleRow, statusRow, lastSyncedRow, pendingRow, syncRow);

  let currentMeta: SyncMeta = meta;
  let currentPendingCount = pending.length;

  function refreshMetaRows(): void {
    statusValue.textContent = enabled ? "On" : "Off";
    lastSyncedValue.textContent = formatSyncAge(currentMeta, now());
    pendingValue.textContent = String(currentPendingCount);
  }
  refreshMetaRows();

  toggleInput.addEventListener("change", () => {
    enabled = toggleInput.checked;
    void storageSet({ [CLOUD_BACKUP_KEY]: enabled });
    refreshMetaRows();
  });

  syncButton.addEventListener("click", async () => {
    syncButton.disabled = true;
    syncButton.textContent = "Syncing…";
    try {
      const outcome = await runCloudSync();
      if (outcome.status === "synced") {
        currentMeta = { lastSyncAt: outcome.at };
        currentPendingCount = (await blockedStore.pending()).length;
      }
      // Only the success/unconfigured path refreshes from currentMeta/currentPendingCount
      // here — refreshMetaRows() would otherwise immediately overwrite the "Sync failed"
      // text the catch below sets, making a real failure invisible to the user.
      refreshMetaRows();
    } catch {
      statusValue.textContent = "Sync failed";
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = "Sync now";
    }
  });

  const dangerCard = document.createElement("div");
  dangerCard.className = "xb-opt-card";
  dangerCard.dataset.danger = "true";

  const dangerHeader = document.createElement("div");
  dangerHeader.className = "xb-opt-card-header";
  const dangerTitle = document.createElement("h2");
  dangerTitle.textContent = "Danger zone";
  dangerHeader.appendChild(dangerTitle);

  const dangerBody = document.createElement("p");
  dangerBody.className = "xb-opt-danger-body";
  dangerBody.textContent =
    "Permanently delete every account this owner has synced to the cloud. This cannot be undone and does not touch your local block/mute list. Turns cloud backup off.";

  const dangerActions = document.createElement("div");
  dangerActions.className = "xb-opt-danger-actions";
  const wipeButton = document.createElement("button");
  wipeButton.type = "button";
  wipeButton.className = "xb-opt-btn";
  wipeButton.dataset.variant = "danger";
  wipeButton.textContent = "Wipe cloud data";
  dangerActions.appendChild(wipeButton);

  const wipePanel = document.createElement("div");
  wipePanel.className = "xb-opt-wipe-panel";
  wipePanel.dataset.open = "false";

  const wipeCaption = document.createElement("p");
  wipeCaption.className = "xb-opt-field-caption";
  wipeCaption.textContent = `Type ${WIPE_CONFIRM_WORD} to confirm.`;

  const wipeRow = document.createElement("div");
  wipeRow.className = "xb-opt-wipe-row";
  const wipeInput = document.createElement("input");
  wipeInput.className = "xb-opt-input";
  wipeInput.setAttribute("aria-label", "Type WIPE to confirm");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "xb-opt-btn";
  cancelButton.dataset.variant = "secondary";
  cancelButton.textContent = "Cancel";
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "xb-opt-btn";
  confirmButton.dataset.variant = "danger";
  confirmButton.textContent = "Confirm wipe";
  confirmButton.disabled = true;
  wipeRow.append(wipeInput, cancelButton, confirmButton);

  const wipeResult = document.createElement("p");
  wipeResult.className = "xb-opt-field-caption";
  wipeResult.hidden = true;

  wipePanel.append(wipeCaption, wipeRow, wipeResult);
  dangerCard.append(dangerHeader, dangerBody, dangerActions, wipePanel);

  function closeWipePanel(): void {
    wipePanel.dataset.open = "false";
    wipeInput.value = "";
    confirmButton.disabled = true;
    wipeResult.hidden = true;
  }

  wipeButton.addEventListener("click", () => {
    wipePanel.dataset.open = "true";
    wipeInput.focus();
  });
  cancelButton.addEventListener("click", closeWipePanel);
  wipeInput.addEventListener("input", () => {
    confirmButton.disabled = wipeInput.value.trim().toUpperCase() !== WIPE_CONFIRM_WORD;
  });
  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    try {
      const { clearCloud: clear } = { clearCloud };
      await clear();
      // The cloud rows are gone, so the queued outbox actions that produced them must
      // never re-push (that would silently repopulate the cloud the user just wiped) —
      // drain the outbox by marking every pending item synced.
      const drained = await blockedStore.pending();
      if (drained.length > 0) {
        await blockedStore.markSynced(drained.map((item) => item.action.actionId));
      }
      // A wiped cloud with backup left on would just refill on the next auto-sync, so
      // the wipe also turns cloud backup off.
      await storageSet({ [SYNC_META_KEY]: {}, [CLOUD_BACKUP_KEY]: false });
      enabled = false;
      toggleInput.checked = false;
      currentMeta = {};
      currentPendingCount = (await blockedStore.pending()).length;
      refreshMetaRows();
      closeWipePanel();
    } catch (error) {
      wipeResult.hidden = false;
      wipeResult.dataset.tone = "danger";
      wipeResult.textContent = `Wipe failed: ${error instanceof Error ? error.message : String(error)}`;
      cancelButton.disabled = false;
      confirmButton.disabled = wipeInput.value.trim().toUpperCase() !== WIPE_CONFIRM_WORD;
    }
  });

  wrapper.append(header, statusCard, dangerCard);
  container.replaceChildren(wrapper);

  return { destroy() {} };
}
