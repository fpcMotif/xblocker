// Catalog: OWL-* (Whitelist pane: add/remove/confirm-destructive/search/import/export).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  exportWhitelist,
  importWhitelist,
  renderWhitelistPane,
  WHITELIST_CONFIRM_WINDOW_MS,
  WHITELIST_IMPORT_MAX,
  WHITELIST_IMPORT_TOO_LARGE_MESSAGE,
  WHITELIST_SEARCH_DEBOUNCE_MS,
} from "../../entrypoints/options/panes/whitelist.ts";
import { installManualTimers, settleMicrotasks, type ManualTimers } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

function addInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[aria-label="Add handle to whitelist"]')!;
}

function addForm(): HTMLFormElement {
  return document.querySelector("form")!;
}

function searchInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[aria-label="Search whitelist"]')!;
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".xb-opt-table-row"));
}

function removeButton(index: number): HTMLButtonElement {
  return rows()[index]!.querySelector<HTMLButtonElement>(".xb-opt-ghost-icon")!;
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

function fileInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

async function submitAdd(value: string): Promise<void> {
  addInput().value = value;
  addForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settleMicrotasks();
}

describe("importWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OWL-01 rejects malformed JSON", async () => {
    expect(await importWhitelist("not json{")).toEqual({ status: "invalid" });
  });

  test("OWL-02 rejects a JSON value that isn't a string array", async () => {
    expect(await importWhitelist(JSON.stringify({ a: 1 }))).toEqual({ status: "invalid" });
    expect(await importWhitelist(JSON.stringify([1, 2]))).toEqual({ status: "invalid" });
  });

  test("OWL-03 rejects an array containing an invalid handle, atomically (nothing written)", async () => {
    const outcome = await importWhitelist(JSON.stringify(["alice", "explore"]));
    expect(outcome).toEqual({ status: "invalid" });
    expect(storageFake.data["whitelist"]).toBeUndefined();
  });

  test("OWL-04 imports valid handles, reporting added vs. skipped-duplicate counts", async () => {
    storageFake.data["whitelist"] = ["alice"];
    const outcome = await importWhitelist(JSON.stringify(["alice", "@bob", "carol"]));
    expect(outcome).toEqual({ status: "imported", added: 2, skippedDuplicates: 1 });
  });

  test("OWL-22 rejects a file over the 10,000-handle cap without reading or writing the whitelist", async () => {
    const handles = Array.from({ length: WHITELIST_IMPORT_MAX + 1 }, (_, i) => `user${i}`);
    const outcome = await importWhitelist(JSON.stringify(handles));
    expect(outcome).toEqual({ status: "tooLarge" });
    expect(storageFake.data["whitelist"]).toBeUndefined();
  });

  test("OWL-23 a file at exactly the cap is imported normally", async () => {
    const handles = Array.from({ length: WHITELIST_IMPORT_MAX }, (_, i) => `user${i}`);
    const outcome = await importWhitelist(JSON.stringify(handles));
    expect(outcome).toEqual({
      status: "imported",
      added: WHITELIST_IMPORT_MAX,
      skippedDuplicates: 0,
    });
  });
});

describe("exportWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OWL-05 hands the list to the download seam as JSON", async () => {
    let captured: string | undefined;
    exportWhitelist(["alice", "bob"], (_filename, blob) => {
      void blob.text().then((text) => (captured = text));
    });
    await settleMicrotasks();
    expect(captured).toBe(JSON.stringify(["alice", "bob"], null, 2));
  });
});

describe("Whitelist pane", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OWL-06 shows the empty state with nothing whitelisted", async () => {
    await renderWhitelistPane(document.body);
    expect(document.body.textContent).toContain("No whitelisted handles yet.");
    expect(rows()).toHaveLength(0);
  });

  test("OWL-07 lists existing entries", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    await renderWhitelistPane(document.body);
    expect(rows().map((row) => row.textContent?.trim().replace(/\s+/g, " "))).toEqual([
      "@alice",
      "@bob",
    ]);
  });

  test("OWL-08 adding a valid handle appends a row and clears the input", async () => {
    await renderWhitelistPane(document.body);
    await submitAdd("newhandle");

    expect(storageFake.data["whitelist"]).toEqual(["newhandle"]);
    expect(rows()).toHaveLength(1);
    expect(addInput().value).toBe("");
  });

  test("OWL-09 adding an invalid handle shows an inline error and does not persist", async () => {
    await renderWhitelistPane(document.body);
    await submitAdd("explore"); // a reserved X path, per normalizeUsername

    expect(addInput().dataset["invalid"]).toBe("true");
    expect(document.querySelector(".xb-opt-field-caption")?.textContent).toBe(
      "Not a valid handle.",
    );
    expect(storageFake.data["whitelist"]).toBeUndefined();
  });

  test("OWL-10 adding a duplicate handle reports it's already whitelisted", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await renderWhitelistPane(document.body);
    await submitAdd("alice");

    expect(document.querySelector(".xb-opt-field-caption")?.textContent).toBe(
      "That handle is already whitelisted.",
    );
  });

  test("OWL-11 a storage failure while adding reports a generic error", async () => {
    await renderWhitelistPane(document.body);
    storageFake.failNextGet = true;
    await submitAdd("dave");

    expect(document.querySelector(".xb-opt-field-caption")?.textContent).toBe(
      "Something went wrong. Try again.",
    );
  });

  test("OWL-12 search filters rows (debounced) and shows a no-matches caption", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    await renderWhitelistPane(document.body);

    searchInput().value = "ali";
    searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, WHITELIST_SEARCH_DEBOUNCE_MS + 10));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("alice");

    searchInput().value = "zzz";
    searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, WHITELIST_SEARCH_DEBOUNCE_MS + 10));
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain('No handles match "zzz".');
  });

  test("OWL-13 removes immediately when 'Confirm destructive actions' is off", async () => {
    storageFake.data["settings"] = { confirmDestructiveActions: false };
    storageFake.data["whitelist"] = ["alice"];
    await renderWhitelistPane(document.body);

    removeButton(0).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks();

    expect(rows()).toHaveLength(0);
    expect(storageFake.data["whitelist"]).toEqual([]);
  });

  describe("with 'Confirm destructive actions' on", () => {
    let timers: ManualTimers;

    beforeEach(() => {
      timers = installManualTimers();
    });

    afterEach(() => {
      timers.uninstall();
    });

    test("OWL-14 first click arms a 'Confirm?' state that auto-resets after the window", async () => {
      storageFake.data["settings"] = { confirmDestructiveActions: true };
      storageFake.data["whitelist"] = ["alice"];
      await renderWhitelistPane(document.body);

      const button = removeButton(0);
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(button.dataset["confirming"]).toBe("true");
      expect(button.textContent).toBe("Confirm?");
      expect(timers.pendingDelays()).toEqual([WHITELIST_CONFIRM_WINDOW_MS]);

      timers.flush();
      expect(removeButton(0).dataset["confirming"]).toBe("false");
      expect(storageFake.data["whitelist"]).toEqual(["alice"]); // never removed
    });

    test("OWL-15 a second click within the window commits the removal", async () => {
      storageFake.data["settings"] = { confirmDestructiveActions: true };
      storageFake.data["whitelist"] = ["alice"];
      await renderWhitelistPane(document.body);

      const button = removeButton(0);
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleMicrotasks();

      expect(rows()).toHaveLength(0);
      expect(storageFake.data["whitelist"]).toEqual([]);
    });
  });

  test("OWL-16 the file-picker seam: no file chosen leaves the form untouched", async () => {
    await renderWhitelistPane(document.body);
    setInputFiles(fileInput(), []);
    fileInput().dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(document.querySelector('[hidden=""]')).toBeTruthy();
  });

  test("OWL-17 clicking Import opens the file picker seam without throwing", async () => {
    await renderWhitelistPane(document.body);
    const importButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Import JSON",
    )!;
    expect(() =>
      importButton.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    ).not.toThrow();
  });

  test("OWL-18 importing a valid file reports counts and refreshes the table", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await renderWhitelistPane(document.body);

    const file = new File([JSON.stringify(["alice", "carol"])], "wl.json", {
      type: "application/json",
    });
    setInputFiles(fileInput(), [file]);
    fileInput().dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(document.body.textContent).toContain("Imported 1, skipped 1 duplicates.");
    expect(rows()).toHaveLength(2);
  });

  test("OWL-19 importing an invalid file reports the format error", async () => {
    await renderWhitelistPane(document.body);

    const file = new File(["not json{"], "wl.json", { type: "application/json" });
    setInputFiles(fileInput(), [file]);
    fileInput().dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(document.body.textContent).toContain("That file isn't a whitelist export.");
  });

  test("OWL-24 importing a file over the cap shows the inline message and leaves the table untouched", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await renderWhitelistPane(document.body);

    const handles = Array.from({ length: WHITELIST_IMPORT_MAX + 1 }, (_, i) => `user${i}`);
    const file = new File([JSON.stringify(handles)], "wl.json", { type: "application/json" });
    setInputFiles(fileInput(), [file]);
    fileInput().dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(document.body.textContent).toContain(WHITELIST_IMPORT_TOO_LARGE_MESSAGE);
    expect(rows()).toHaveLength(1);
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
  });

  test("OWL-20 clicking Export hands the current list to the download seam", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await renderWhitelistPane(document.body);
    const exportButton = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Export JSON",
    )!;
    expect(() =>
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    ).not.toThrow();
  });

  test("OWL-21 destroy() clears a pending search debounce without throwing", async () => {
    const handle = await renderWhitelistPane(document.body);
    searchInput().value = "a";
    searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    expect(() => handle.destroy()).not.toThrow();
  });
});
