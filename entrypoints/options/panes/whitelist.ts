// Whitelist pane: backed by packages/storage/whitelist-store only (no other storage). The store keeps
// just an ordered list of handles, no per-entry "added at" timestamp — so the table shows
// Handle + Remove only rather than fabricating a date the store never recorded.

import { createIcon } from "../../lib/icons";
import { normalizeSettings, normalizeUsername } from "../../../packages/storage/settings";
import {
  addManyToWhitelist,
  addToWhitelist,
  getWhitelist,
  removeFromWhitelist,
  type WhitelistAddResult,
} from "../../../packages/storage/whitelist-store";
import { storageGet, SETTINGS_KEY } from "../../../packages/storage/chrome-storage";
import { downloadJson, type DownloadFn } from "../download";

export const WHITELIST_SEARCH_DEBOUNCE_MS = 120;
export const WHITELIST_CONFIRM_WINDOW_MS = 3000;

/** Above this many handles a file is rejected outright rather than run through the
 *  batched mutation — keeps a single import from blocking the mutation queue for an
 *  unbounded amount of time. */
export const WHITELIST_IMPORT_MAX = 10_000;
export const WHITELIST_IMPORT_TOO_LARGE_MESSAGE = "Import too large (max 10,000 handles).";

export type WhitelistImportOutcome =
  | { status: "invalid" }
  | { status: "tooLarge" }
  | { status: "imported"; added: number; skippedDuplicates: number };

/** Shape-validate then persist a whitelist export file's contents through
 *  addManyToWhitelist's single-read/single-write batch path — no per-item
 *  read-modify-write, so a large file doesn't cost O(n^2). Rejects (as "invalid")
 *  unless every element is a string that normalizeUsername accepts; that check runs to
 *  completion before anything is written, so a bad file never partially imports. Rejects
 *  (as "tooLarge") a file with more than WHITELIST_IMPORT_MAX handles, before spending
 *  any time validating or writing it. */
export async function importWhitelist(raw: string): Promise<WhitelistImportOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    return { status: "invalid" };
  }
  if (parsed.length > WHITELIST_IMPORT_MAX) {
    return { status: "tooLarge" };
  }
  const usernames = parsed.map((item) => normalizeUsername(item));
  const validUsernames = usernames.filter((username): username is string => username !== null);
  if (validUsernames.length !== usernames.length) {
    return { status: "invalid" };
  }

  const { added, skipped } = await addManyToWhitelist(validUsernames);
  return { status: "imported", added, skippedDuplicates: skipped };
}

/** Small seam so tests can stub Blob/URL/anchor-click behavior. */
export function exportWhitelist(list: string[], download?: DownloadFn): void {
  downloadJson("xblocker-whitelist.json", list, download);
}

type PaneHandle = { destroy(): void };

export async function renderWhitelistPane(container: HTMLElement): Promise<PaneHandle> {
  const [whitelist, storedSettings] = await Promise.all([
    getWhitelist(),
    storageGet<unknown>(SETTINGS_KEY),
  ]);
  const confirmRequired = normalizeSettings(storedSettings).confirmDestructiveActions;
  let entries = [...whitelist];
  let searchQuery = "";
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;

  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-pane-table";

  const header = document.createElement("div");
  header.className = "xb-opt-pane-header";
  const h1 = document.createElement("h1");
  h1.textContent = "Whitelist";
  const desc = document.createElement("p");
  desc.textContent = "Handles excluded from bulk block and mute runs.";
  header.append(h1, desc);

  const toolbar = document.createElement("div");
  toolbar.className = "xb-opt-toolbar";

  const addForm = document.createElement("form");
  addForm.style.display = "flex";
  addForm.style.gap = "8px";

  const addInput = document.createElement("input");
  addInput.className = "xb-opt-input";
  addInput.placeholder = "@handle";
  addInput.autocomplete = "off";
  addInput.setAttribute("aria-label", "Add handle to whitelist");

  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "xb-opt-btn";
  addButton.dataset.variant = "primary";
  addButton.textContent = "Add";

  addForm.append(addInput, addButton);

  const addCaption = document.createElement("p");
  addCaption.className = "xb-opt-field-caption";
  addCaption.hidden = true;

  const searchInput = document.createElement("input");
  searchInput.className = "xb-opt-input";
  searchInput.type = "search";
  searchInput.placeholder = "Search whitelist";
  searchInput.setAttribute("aria-label", "Search whitelist");

  const spacer = document.createElement("div");
  spacer.className = "xb-opt-toolbar-spacer";

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "xb-opt-btn";
  importButton.dataset.variant = "secondary";
  importButton.textContent = "Import JSON";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "xb-opt-btn";
  exportButton.dataset.variant = "secondary";
  exportButton.textContent = "Export JSON";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.hidden = true;

  toolbar.append(addForm, searchInput, spacer, importButton, exportButton, fileInput);

  const importResult = document.createElement("p");
  importResult.className = "xb-opt-field-caption";
  importResult.hidden = true;

  const tableArea = document.createElement("div");

  wrapper.append(header, toolbar, addCaption, importResult, tableArea);
  container.replaceChildren(wrapper);

  function createRemoveControl(handle: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xb-opt-ghost-icon";
    button.setAttribute("aria-label", `Remove ${handle} from whitelist`);
    button.appendChild(createIcon("cross", 14));

    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    function resetControl(): void {
      if (confirmTimer !== undefined) {
        clearTimeout(confirmTimer);
        confirmTimer = undefined;
      }
      button.dataset.confirming = "false";
      button.replaceChildren(createIcon("cross", 14));
    }

    async function commitRemove(): Promise<void> {
      resetControl();
      await removeFromWhitelist(handle);
      entries = entries.filter((entry) => entry.toLowerCase() !== handle.toLowerCase());
      drawTable();
    }

    button.addEventListener("click", () => {
      if (!confirmRequired || button.dataset.confirming === "true") {
        void commitRemove();
        return;
      }
      button.dataset.confirming = "true";
      button.textContent = "Confirm?";
      confirmTimer = setTimeout(resetControl, WHITELIST_CONFIRM_WINDOW_MS);
    });

    return button;
  }

  function visibleEntries(): string[] {
    if (!searchQuery) return entries;
    const needle = searchQuery.toLowerCase();
    return entries.filter((handle) => handle.toLowerCase().includes(needle));
  }

  function drawTable(): void {
    const visible = visibleEntries();

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "xb-opt-empty";
      const title = document.createElement("p");
      title.textContent = "No whitelisted handles yet.";
      const hint = document.createElement("p");
      hint.textContent = "Add a handle above to exclude it from bulk block and mute runs.";
      empty.append(title, hint);
      tableArea.replaceChildren(empty);
      return;
    }

    const table = document.createElement("div");
    table.className = "xb-opt-table";

    const head = document.createElement("div");
    head.className = "xb-opt-table-head";
    head.style.gridTemplateColumns = "1fr 40px";
    const handleHead = document.createElement("span");
    handleHead.textContent = "Handle";
    head.append(handleHead, document.createElement("span"));
    table.appendChild(head);

    if (visible.length === 0) {
      const noMatches = document.createElement("p");
      noMatches.className = "xb-opt-field-caption";
      noMatches.style.padding = "16px";
      noMatches.textContent = `No handles match "${searchQuery}".`;
      table.appendChild(noMatches);
    }

    for (const handle of visible) {
      const row = document.createElement("div");
      row.className = "xb-opt-table-row";
      row.style.gridTemplateColumns = "1fr 40px";
      row.tabIndex = 0;

      const handleCell = document.createElement("span");
      handleCell.className = "xb-opt-cell-handle";
      handleCell.textContent = `@${handle}`;

      row.append(handleCell, createRemoveControl(handle));
      table.appendChild(row);
    }

    tableArea.replaceChildren(table);
  }

  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = addInput.value;
    const result: WhitelistAddResult = await addToWhitelist(raw);
    if (result === "added") {
      const username = normalizeUsername(raw);
      if (username) entries = [...entries, username];
      addInput.value = "";
      addInput.removeAttribute("data-invalid");
      addCaption.hidden = true;
      drawTable();
      return;
    }
    addInput.dataset.invalid = "true";
    addCaption.hidden = false;
    addCaption.dataset.tone = "danger";
    addCaption.textContent =
      result === "invalid"
        ? "Not a valid handle."
        : result === "exists"
          ? "That handle is already whitelisted."
          : "Something went wrong. Try again.";
  });

  searchInput.addEventListener("input", () => {
    if (searchDebounce !== undefined) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      drawTable();
    }, WHITELIST_SEARCH_DEBOUNCE_MS);
  });

  exportButton.addEventListener("click", () => {
    exportWhitelist(entries);
  });

  importButton.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const raw = await file.text();
    const outcome = await importWhitelist(raw);
    importResult.hidden = false;
    if (outcome.status === "invalid") {
      importResult.dataset.tone = "danger";
      importResult.textContent = "That file isn't a whitelist export.";
      return;
    }
    if (outcome.status === "tooLarge") {
      importResult.dataset.tone = "danger";
      importResult.textContent = WHITELIST_IMPORT_TOO_LARGE_MESSAGE;
      return;
    }
    importResult.removeAttribute("data-tone");
    importResult.textContent = `Imported ${outcome.added}, skipped ${outcome.skippedDuplicates} duplicates.`;
    entries = await getWhitelist();
    drawTable();
  });

  drawTable();

  return {
    destroy() {
      if (searchDebounce !== undefined) clearTimeout(searchDebounce);
    },
  };
}
