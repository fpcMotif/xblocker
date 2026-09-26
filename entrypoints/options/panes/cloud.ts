// Cloud backup pane. Cloud-session owns lazy transport loading and wipe orchestration.
//
// One "Cloud backup" toggle and one "Sync now" button drive every synced collection
// (ADR-0005); the pane shows each collection's own status block (status / last synced
// / pending) so the user can tell whether the whitelist specifically is caught up.
// "Wipe cloud data" stays blocklist-only by spec: it never touches cloud-mirrored
// whitelist rows.

import {
  type CloudSyncDeps,
  createCloudSyncSession,
  formatSyncAge,
} from "../../../packages/sync/cloud-session";
import { CLOUD_BACKUP_KEY, storageSet } from "../../../packages/storage/chrome-storage";
import {
  blockedCollection,
  readCloudDisplayState,
  whitelistCollection,
  type SyncMeta,
} from "../../../packages/sync/sync-engine";

export const WIPE_CONFIRM_WORD = "WIPE";
import * as stylex from "@stylexjs/stylex";
import { optionsShellStyles as shellStyles } from "../options-shell.stylex";
import { optionsTableStyles as tableStyles } from "../options-table.stylex";

export { formatSyncAge };
type PaneHandle = { destroy(): void };

const PANE_DESC = "Mirror your blocked list and whitelist to your private Convex project.";

function renderUnconfigured(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = `${stylex.props(shellStyles.paneForm).className} xb-opt-pane-form`;

  const header = document.createElement("div");
  header.className = `${stylex.props(shellStyles.paneHeader).className} xb-opt-pane-header`;
  const h1 = document.createElement("h1");
  h1.className = `${stylex.props(shellStyles.paneHeaderH1).className}`;
  h1.textContent = "Cloud backup";
  const desc = document.createElement("p");
  desc.className = `${stylex.props(shellStyles.paneHeaderP).className}`;
  desc.textContent = PANE_DESC;
  header.append(h1, desc);

  const card = document.createElement("div");
  card.className = `${stylex.props(shellStyles.empty).className} xb-opt-empty`;
  const title = document.createElement("p");
  title.textContent = "Cloud backup isn't configured for this build.";
  const caption = document.createElement("p");
  caption.className = `${stylex.props(tableStyles.fieldCaption).className} xb-opt-field-caption`;
  caption.textContent = "Neither your blocked list nor your whitelist is syncing.";
  card.append(title, caption);

  wrapper.append(header, card);
  container.replaceChildren(wrapper);
}

type CollectionBlock = {
  element: HTMLElement;
  setDisplay(enabled: boolean, meta: SyncMeta, pendingCount: number): void;
  setStatusText(text: string): void;
};

/** One collection's status block: a leading row named after the collection carrying
 *  its On/Off status, then Last synced / Pending actions rows. */
function buildCollectionBlock(title: string, now: () => number): CollectionBlock {
  function metaRow(label: string): { row: HTMLElement; value: HTMLElement } {
    const row = document.createElement("div");
    row.className = `${stylex.props(shellStyles.row, shellStyles.rowMeta).className} xb-opt-row xb-opt-row-meta`;
    const labelEl = document.createElement("span");
    labelEl.className = `${stylex.props(shellStyles.rowTitle).className} xb-opt-row-title`;
    labelEl.textContent = label;
    const value = document.createElement("span");
    value.className = `${stylex.props(shellStyles.rowValue).className} xb-opt-row-value`;
    row.append(labelEl, value);
    return { row, value };
  }

  const status = metaRow(title);
  const lastSynced = metaRow("Last synced");
  const pending = metaRow("Pending actions");

  const element = document.createElement("div");
  element.append(status.row, lastSynced.row, pending.row);

  return {
    element,
    setDisplay(enabled, meta, pendingCount) {
      status.value.textContent = enabled ? "On" : "Off";
      lastSynced.value.textContent = formatSyncAge(meta, now());
      pending.value.textContent = String(pendingCount);
    },
    setStatusText(text) {
      status.value.textContent = text;
    },
  };
}

export async function renderCloudPane(
  container: HTMLElement,
  opts: RenderCloudPaneOptions = {},
): Promise<PaneHandle> {
  const now = opts.now ?? Date.now;
  const syncSession = createCloudSyncSession(opts);

  if (!(await syncSession.isBuildConfigured())) {
    renderUnconfigured(container);
    return { destroy() {} };
  }

  const [blockedDisplay, whitelistDisplay] = await Promise.all([
    readCloudDisplayState(blockedCollection),
    readCloudDisplayState(whitelistCollection),
  ]);
  let enabled = blockedDisplay.enabled;

  const wrapper = document.createElement("div");
  wrapper.className = `${stylex.props(shellStyles.paneForm).className} xb-opt-pane-form`;

  const header = document.createElement("div");
  header.className = `${stylex.props(shellStyles.paneHeader).className} xb-opt-pane-header`;
  const h1 = document.createElement("h1");
  h1.className = `${stylex.props(shellStyles.paneHeaderH1).className}`;
  h1.textContent = "Cloud backup";
  const desc = document.createElement("p");
  desc.className = `${stylex.props(shellStyles.paneHeaderP).className}`;
  desc.textContent = PANE_DESC;
  header.append(h1, desc);

  const statusCard = document.createElement("div");
  statusCard.className = `${stylex.props(shellStyles.card).className} xb-opt-card`;

  const toggleRow = document.createElement("label");
  toggleRow.className = `${stylex.props(shellStyles.row).className} xb-opt-row`;
  const toggleCopy = document.createElement("span");
  toggleCopy.className = `${stylex.props(shellStyles.rowCopy).className} xb-opt-row-copy`;
  const toggleTitle = document.createElement("span");
  toggleTitle.className = `${stylex.props(shellStyles.rowTitle).className} xb-opt-row-title`;
  toggleTitle.textContent = "Back up blocked list and whitelist";
  const toggleCaption = document.createElement("span");
  toggleCaption.className = `${stylex.props(shellStyles.rowCaption).className} xb-opt-row-caption`;
  toggleCaption.textContent = "One switch mirrors both lists to your Convex project.";
  toggleCopy.append(toggleTitle, toggleCaption);
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.className = `${stylex.props(shellStyles.switchInput).className} xb-opt-switch`;
  toggleInput.checked = enabled;
  toggleRow.append(toggleCopy, toggleInput);

  const blockedBlock = buildCollectionBlock("Blocked list", now);
  const whitelistBlock = buildCollectionBlock("Whitelist", now);

  const syncRow = document.createElement("div");
  syncRow.className = `${stylex.props(shellStyles.row, shellStyles.rowLast).className} xb-opt-row`;
  const syncButton = document.createElement("button");
  syncButton.type = "button";
  syncButton.className = `${stylex.props(tableStyles.btn, tableStyles.btnSecondary).className} xb-opt-btn`;
  syncButton.dataset.variant = "secondary";
  syncButton.style.setProperty("--xb-opt-btn-reserve", "88px");
  syncButton.textContent = "Sync now";
  syncRow.append(syncButton);

  statusCard.append(toggleRow, blockedBlock.element, whitelistBlock.element, syncRow);

  function refreshBlocks(
    blocked: { meta: SyncMeta; pendingCount: number },
    whitelist: { meta: SyncMeta; pendingCount: number },
  ): void {
    blockedBlock.setDisplay(enabled, blocked.meta, blocked.pendingCount);
    whitelistBlock.setDisplay(enabled, whitelist.meta, whitelist.pendingCount);
  }
  refreshBlocks(blockedDisplay, whitelistDisplay);

  // The latest rendered per-collection state, kept so the toggle and wipe paths can
  // re-render without re-reading storage.
  let currentBlocked = { meta: blockedDisplay.meta, pendingCount: blockedDisplay.pendingCount };
  let currentWhitelist = {
    meta: whitelistDisplay.meta,
    pendingCount: whitelistDisplay.pendingCount,
  };

  toggleInput.addEventListener("change", () => {
    enabled = toggleInput.checked;
    void storageSet({ [CLOUD_BACKUP_KEY]: enabled });
    refreshBlocks(currentBlocked, currentWhitelist);
  });

  syncButton.addEventListener("click", async () => {
    syncButton.disabled = true;
    syncButton.textContent = "Syncing…";
    try {
      const result = await syncSession.runManual();
      if (result?.outcome.status === "synced") {
        // The sync stamped both collections' meta and drained both outboxes — re-read
        // both instead of assuming, so a partially-failed future change can't desync
        // the two blocks.
        const [nextBlocked, nextWhitelist] = await Promise.all([
          readCloudDisplayState(blockedCollection),
          readCloudDisplayState(whitelistCollection),
        ]);
        currentBlocked = { meta: nextBlocked.meta, pendingCount: nextBlocked.pendingCount };
        currentWhitelist = { meta: nextWhitelist.meta, pendingCount: nextWhitelist.pendingCount };
      }
      // Only the success/unconfigured path refreshes from the current display state
      // here — refreshBlocks() would otherwise immediately overwrite the "Sync failed"
      // text the catch below sets, making a real failure invisible to the user.
      refreshBlocks(currentBlocked, currentWhitelist);
    } catch {
      blockedBlock.setStatusText("Sync failed");
      whitelistBlock.setStatusText("Sync failed");
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = "Sync now";
    }
  });

  const dangerCard = document.createElement("div");
  dangerCard.className = `${stylex.props(shellStyles.card, shellStyles.cardNext, shellStyles.cardDanger).className} xb-opt-card`;
  dangerCard.dataset.danger = "true";

  const dangerHeader = document.createElement("div");
  dangerHeader.className = `${stylex.props(shellStyles.cardHeader).className} xb-opt-card-header`;
  const dangerTitle = document.createElement("h2");
  dangerTitle.className = `${stylex.props(shellStyles.cardHeaderH2, shellStyles.cardHeaderH2Danger).className}`;
  dangerTitle.textContent = "Danger zone";
  dangerHeader.appendChild(dangerTitle);

  const dangerBody = document.createElement("p");
  dangerBody.className = `${stylex.props(shellStyles.dangerBody).className} xb-opt-danger-body`;
  dangerBody.textContent =
    "Permanently delete every account this owner has synced to the cloud. This cannot be undone and does not touch your local block/mute list or your cloud-mirrored whitelist. Turns cloud backup off.";

  const dangerActions = document.createElement("div");
  dangerActions.className = `${stylex.props(shellStyles.dangerActions).className} xb-opt-danger-actions`;
  const wipeButton = document.createElement("button");
  wipeButton.type = "button";
  wipeButton.className = `${stylex.props(tableStyles.btn, tableStyles.btnDanger).className} xb-opt-btn`;
  wipeButton.dataset.variant = "danger";
  wipeButton.textContent = "Wipe cloud data";
  dangerActions.appendChild(wipeButton);

  const wipePanel = document.createElement("div");
  wipePanel.className = `${stylex.props(shellStyles.wipePanel).className} xb-opt-wipe-panel`;
  wipePanel.dataset.open = "false";

  const wipeCaption = document.createElement("p");
  wipeCaption.className = `${stylex.props(tableStyles.fieldCaption).className} xb-opt-field-caption`;
  wipeCaption.textContent = `Type ${WIPE_CONFIRM_WORD} to confirm.`;

  const wipeRow = document.createElement("div");
  wipeRow.className = `${stylex.props(shellStyles.wipeRow).className} xb-opt-wipe-row`;
  const wipeInput = document.createElement("input");
  wipeInput.className = `${stylex.props(tableStyles.input).className} xb-opt-input`;
  wipeInput.setAttribute("aria-label", "Type WIPE to confirm");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = `${stylex.props(tableStyles.btn, tableStyles.btnSecondary).className} xb-opt-btn`;
  cancelButton.dataset.variant = "secondary";
  cancelButton.textContent = "Cancel";
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = `${stylex.props(tableStyles.btn, tableStyles.btnDanger).className} xb-opt-btn`;
  confirmButton.dataset.variant = "danger";
  confirmButton.textContent = "Confirm wipe";
  confirmButton.disabled = true;
  wipeRow.append(wipeInput, cancelButton, confirmButton);

  const wipeResult = document.createElement("p");
  wipeResult.className = `${stylex.props(tableStyles.fieldCaption, tableStyles.fieldCaptionDanger).className} xb-opt-field-caption`;
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
      const result = await syncSession.wipeCloud();
      enabled = false;
      toggleInput.checked = false;
      // The wipe is blocklist-only: reset the blocked block, leave the whitelist's
      // cloud state (and its displayed sync status) untouched.
      currentBlocked = { meta: {}, pendingCount: result.pendingCount };
      refreshBlocks(currentBlocked, currentWhitelist);
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

export type RenderCloudPaneOptions = Pick<
  CloudSyncDeps,
  "clearCloud" | "loadAdapter" | "now" | "probeConfigured"
>;
