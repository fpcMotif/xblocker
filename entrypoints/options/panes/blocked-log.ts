// Blocked log pane: wires blockedStore.list() (previously unused) into a searchable,
// filterable, virtualized ledger of every account the extension has ever acted on.

import type { BlockedAccount } from "../../lib/blocked-merge";
import { blockedStore } from "../../lib/blocked-store";
import { CLOUD_BACKUP_KEY, storageGet } from "../../lib/chrome-storage";
import { createLiveNumber, formatCount } from "../../lib/live-number";
import { createVirtualList, type VirtualList } from "../virtual-list";
import { downloadJson } from "../download";

export const BLOCKED_LOG_ROW_HEIGHT = 36;
export const BLOCKED_LOG_SEARCH_DEBOUNCE_MS = 120;
export const JUMP_TO_TOP_THRESHOLD = 800;

export type ActionFilter = "all" | "block" | "mute";
export type SyncFilter = "all" | "synced" | "pending" | "local";
export type RowSyncStatus = "synced" | "pending" | "local";

/** The account's headline action for the log's single Action column. An account can carry
 *  both block and mute history (it is one ledger row per person, not per action) — this
 *  picks the most recent non-unblock action, falling back to whichever counter is set for
 *  accounts folded in from a cloud pull with an empty `actions[]`. */
export function primaryActionKind(account: BlockedAccount): "block" | "mute" {
  for (let i = account.actions.length - 1; i >= 0; i--) {
    const kind = account.actions[i]?.kind;
    if (kind === "block" || kind === "mute") return kind;
  }
  return account.muteCount > 0 && account.blockCount === 0 ? "mute" : "block";
}

/** Local-only when cloud backup is off entirely (nothing will ever sync); otherwise
 *  pending while the account's key still sits in the outbox, synced once it's drained. */
export function computeSyncStatus(
  accountKey: string,
  pendingKeys: ReadonlySet<string>,
  cloudBackupEnabled: boolean,
): RowSyncStatus {
  if (!cloudBackupEnabled) return "local";
  return pendingKeys.has(accountKey) ? "pending" : "synced";
}

/** Coarse "how long ago", matched at the `59m` -> `1h` boundary the plan pins. */
export function formatRelativeShort(deltaMs: number): string {
  const seconds = Math.floor(Math.max(0, deltaMs) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

type Row = {
  account: BlockedAccount;
  action: "block" | "mute";
  sync: RowSyncStatus;
};

const ROW_GRID = "1.6fr 88px 72px 96px";

function actionLabel(action: "block" | "mute"): string {
  return action === "block" ? "Block" : "Mute";
}

function syncLabel(sync: RowSyncStatus): string {
  return sync === "synced" ? "Synced" : sync === "pending" ? "Pending" : "Local";
}

type PaneHandle = { destroy(): void };

export type BlockedLogPaneOptions = {
  /** Overrides the virtualizer's viewport-height read (see virtual-list.ts); tests supply
   *  a fixed number since happy-dom never lays elements out. */
  getViewportHeight?: () => number;
  now?: () => number;
};

export async function renderBlockedLogPane(
  container: HTMLElement,
  opts: BlockedLogPaneOptions = {},
): Promise<PaneHandle> {
  const now = opts.now ?? Date.now;
  const [accounts, outbox, cloudBackupEnabled] = await Promise.all([
    blockedStore.list(),
    blockedStore.pending(),
    storageGet<boolean>(CLOUD_BACKUP_KEY),
  ]);
  const pendingKeys = new Set(outbox.map((item) => item.accountKey));
  const cloudEnabled = cloudBackupEnabled === true;

  const rows: Row[] = accounts
    .map((account) => ({
      account,
      action: primaryActionKind(account),
      sync: computeSyncStatus(account.key, pendingKeys, cloudEnabled),
    }))
    .toSorted((a, b) => b.account.lastActionAt - a.account.lastActionAt);

  let searchQuery = "";
  let actionFilter: ActionFilter = "all";
  let syncFilter: SyncFilter = "all";
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;
  let focusedIndex = 0;

  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-pane-table";

  const header = document.createElement("div");
  header.className = "xb-opt-pane-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Blocked log";
  const desc = document.createElement("p");
  desc.textContent = "Every account block and mute runs have acted on.";
  header.append(h1, desc);

  const toolbar = document.createElement("div");
  toolbar.className = "xb-opt-toolbar";

  const searchInput = document.createElement("input");
  searchInput.className = "xb-opt-input";
  searchInput.type = "search";
  searchInput.placeholder = "Search handle";
  searchInput.setAttribute("aria-label", "Search blocked log");

  function createChipGroup<T extends string>(
    label: string,
    options: Array<[T, string]>,
    active: T,
    onSelect: (value: T) => void,
  ): HTMLDivElement {
    const group = document.createElement("div");
    group.className = "xb-opt-chip-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);

    const buttons: HTMLButtonElement[] = [];
    for (const [value, text] of options) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "xb-opt-chip";
      chip.textContent = text;
      chip.setAttribute("aria-pressed", String(value === active));
      chip.addEventListener("click", () => {
        for (const other of buttons) other.setAttribute("aria-pressed", "false");
        chip.setAttribute("aria-pressed", "true");
        onSelect(value);
      });
      buttons.push(chip);
      group.appendChild(chip);
    }
    return group;
  }

  const actionChips = createChipGroup<ActionFilter>(
    "Filter by action",
    [
      ["all", "All"],
      ["block", "Block"],
      ["mute", "Mute"],
    ],
    actionFilter,
    (value) => {
      actionFilter = value;
      applyFilters();
    },
  );

  const syncChips = createChipGroup<SyncFilter>(
    "Filter by sync status",
    [
      ["all", "All"],
      ["synced", "Synced"],
      ["pending", "Pending"],
      ["local", "Local"],
    ],
    syncFilter,
    (value) => {
      syncFilter = value;
      applyFilters();
    },
  );

  const spacer = document.createElement("div");
  spacer.className = "xb-opt-toolbar-spacer";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "xb-opt-btn";
  exportButton.dataset.variant = "secondary";
  exportButton.textContent = "Export JSON";
  exportButton.addEventListener("click", () => {
    downloadJson(
      "xblocker-blocked-log.json",
      rows.map((row) => ({
        handle: row.account.handle,
        action: row.action,
        lastActionAt: row.account.lastActionAt,
        sync: row.sync,
      })),
    );
  });

  toolbar.append(searchInput, actionChips, syncChips, spacer, exportButton);

  const bodyArea = document.createElement("div");

  const footer = document.createElement("div");
  footer.className = "xb-opt-footer";
  const footerCount = document.createElement("p");
  footerCount.className = "xb-opt-footer-count";
  const countNumber = document.createElement("span");
  countNumber.className = "xb-opt-tabular";
  const countNoun = document.createElement("span");
  footerCount.append(countNumber, countNoun);
  const jumpTopButton = document.createElement("button");
  jumpTopButton.type = "button";
  jumpTopButton.className = "xb-opt-jump-top";
  jumpTopButton.textContent = "Jump to top";
  jumpTopButton.hidden = true;
  footer.append(footerCount, jumpTopButton);

  wrapper.append(header, toolbar, bodyArea, footer);
  container.replaceChildren(wrapper);

  const liveCount = createLiveNumber(countNumber);
  function setFooterCount(count: number): void {
    countNoun.textContent = ` ${count === 1 ? "account" : "accounts"}`;
    footerCount.setAttribute("aria-label", formatCount(count, "account", "accounts"));
    liveCount.set(count);
  }

  let filtered: Row[] = [];
  let tableScroll: HTMLElement | undefined;
  let virtualList: VirtualList<Row> | undefined;
  let onScroll: (() => void) | undefined;
  let onKeydown: ((event: KeyboardEvent) => void) | undefined;

  function renderRow(row: Row, index: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "xb-opt-table-row";
    el.style.gridTemplateColumns = ROW_GRID;
    el.tabIndex = index === focusedIndex ? 0 : -1;
    el.setAttribute("role", "row");

    const handleCell = document.createElement("span");
    handleCell.className = "xb-opt-cell-handle";
    handleCell.textContent = `@${row.account.handle}`;

    const actionCell = document.createElement("span");
    actionCell.className = "xb-opt-cell-action";
    const dot = document.createElement("span");
    dot.className = "xb-opt-tone-dot";
    dot.dataset.tone = row.action === "block" ? "danger" : "warning";
    const actionText = document.createElement("span");
    actionText.textContent = actionLabel(row.action);
    actionCell.append(dot, actionText);

    const whenCell = document.createElement("span");
    whenCell.className = "xb-opt-cell-when";
    whenCell.textContent = formatRelativeShort(now() - row.account.lastActionAt);
    whenCell.title = new Date(row.account.lastActionAt).toLocaleString();

    const syncCell = document.createElement("span");
    syncCell.className = "xb-opt-cell-action";
    const syncDot = document.createElement("span");
    syncDot.className = "xb-opt-sync-dot";
    syncDot.dataset.sync = row.sync;
    const syncText = document.createElement("span");
    syncText.textContent = syncLabel(row.sync);
    syncCell.append(syncDot, syncText);

    el.append(handleCell, actionCell, whenCell, syncCell);
    return el;
  }

  function renderEmptyState(trueEmpty: boolean): void {
    tableScroll = undefined;
    virtualList = undefined;
    const empty = document.createElement("div");
    empty.className = "xb-opt-empty";
    const title = document.createElement("p");
    title.textContent = trueEmpty ? "No blocked accounts yet." : "No accounts match these filters.";
    const hint = document.createElement("p");
    hint.textContent = trueEmpty
      ? "Bulk actions from the reply rail will populate this log."
      : "Try a different search or filter.";
    empty.append(title, hint);
    bodyArea.replaceChildren(empty);
  }

  function buildTable(): void {
    const table = document.createElement("div");
    table.className = "xb-opt-table";

    const head = document.createElement("div");
    head.className = "xb-opt-table-head";
    head.style.gridTemplateColumns = ROW_GRID;
    for (const label of ["Handle", "Action", "When", "Sync"]) {
      const cell = document.createElement("span");
      cell.textContent = label;
      head.appendChild(cell);
    }
    table.appendChild(head);

    const scroll = document.createElement("div");
    scroll.className = "xb-opt-table-scroll";
    scroll.setAttribute("role", "rowgroup");
    table.appendChild(scroll);
    bodyArea.replaceChildren(table);
    tableScroll = scroll;

    virtualList = createVirtualList<Row>({
      container: scroll,
      rowHeight: BLOCKED_LOG_ROW_HEIGHT,
      renderRow,
      ...(opts.getViewportHeight ? { getViewportHeight: opts.getViewportHeight } : {}),
    });

    onScroll = () => {
      jumpTopButton.hidden = scroll.scrollTop <= JUMP_TO_TOP_THRESHOLD;
    };
    scroll.addEventListener("scroll", onScroll);

    onKeydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const delta =
        event.key === "ArrowDown" || event.key === "j"
          ? 1
          : event.key === "ArrowUp" || event.key === "k"
            ? -1
            : 0;
      if (delta === 0) return;
      event.preventDefault();
      focusRow(focusedIndex + delta);
    };
    scroll.addEventListener("keydown", onKeydown);
  }

  function focusRow(index: number): void {
    if (filtered.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), filtered.length - 1);
    focusedIndex = clamped;
    if (!tableScroll || !virtualList) return;

    const rowTop = clamped * BLOCKED_LOG_ROW_HEIGHT;
    const rowBottom = rowTop + BLOCKED_LOG_ROW_HEIGHT;
    const viewportHeight = opts.getViewportHeight?.() ?? tableScroll.clientHeight;
    if (rowTop < tableScroll.scrollTop) {
      tableScroll.scrollTop = rowTop;
    } else if (rowBottom > tableScroll.scrollTop + viewportHeight) {
      tableScroll.scrollTop = rowBottom - viewportHeight;
    }
    virtualList.setItems(filtered);
    virtualList.findRowElement(clamped)?.focus();
  }

  function applyFilters(): void {
    filtered = rows.filter((row) => {
      if (actionFilter !== "all" && row.action !== actionFilter) return false;
      if (syncFilter !== "all" && row.sync !== syncFilter) return false;
      if (searchQuery && !row.account.handle.toLowerCase().includes(searchQuery)) return false;
      return true;
    });
    setFooterCount(filtered.length);
    focusedIndex = Math.min(focusedIndex, Math.max(0, filtered.length - 1));

    if (filtered.length === 0) {
      renderEmptyState(rows.length === 0);
      return;
    }
    if (!tableScroll || !virtualList) {
      buildTable();
    }
    virtualList?.setItems(filtered);
  }

  searchInput.addEventListener("input", () => {
    if (searchDebounce !== undefined) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = searchInput.value.trim().toLowerCase();
      applyFilters();
    }, BLOCKED_LOG_SEARCH_DEBOUNCE_MS);
  });

  jumpTopButton.addEventListener("click", () => {
    if (tableScroll) tableScroll.scrollTop = 0;
  });

  applyFilters();

  return {
    destroy() {
      if (searchDebounce !== undefined) clearTimeout(searchDebounce);
      if (tableScroll && onScroll) tableScroll.removeEventListener("scroll", onScroll);
      if (tableScroll && onKeydown) tableScroll.removeEventListener("keydown", onKeydown);
      virtualList?.destroy();
      liveCount.destroy();
    },
  };
}
