// Catalog: OBL-* (Blocked log pane: pure helpers + the virtualized, filterable ledger).
import { beforeEach, describe, expect, test } from "bun:test";

import type { BlockAction, BlockedAccount } from "../../packages/storage/blocked-merge.ts";
import {
  BLOCKED_LOG_SEARCH_DEBOUNCE_MS,
  computeSyncStatus,
  formatRelativeShort,
  JUMP_TO_TOP_THRESHOLD,
  primaryActionKind,
  renderBlockedLogPane,
} from "../../entrypoints/options/panes/blocked-log.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

const VIEWPORT_HEIGHT = 400; // renders every row for small fixtures at 36px rows

function mkAccount(
  partial: Partial<BlockedAccount> & Pick<BlockedAccount, "key" | "handle">,
): BlockedAccount {
  return {
    idUnknown: false,
    firstActionAt: 0,
    lastActionAt: 0,
    blockCount: 0,
    muteCount: 0,
    status: "active",
    actions: [],
    ...partial,
  };
}

function mkAction(partial: Partial<BlockAction> & Pick<BlockAction, "kind">): BlockAction {
  return { actionId: `a-${Math.random()}`, at: 0, source: "reply-bar", ...partial };
}

describe("primaryActionKind", () => {
  test("OBL-01 picks the most recent block/mute action, skipping trailing unblocks", () => {
    const account = mkAccount({
      key: "1",
      handle: "a",
      actions: [
        mkAction({ kind: "block" }),
        mkAction({ kind: "mute" }),
        mkAction({ kind: "unblock" }),
      ],
    });
    expect(primaryActionKind(account)).toBe("mute");
  });

  test("OBL-02 falls back to muteCount/blockCount when actions[] is empty (folded from a cloud pull)", () => {
    expect(
      primaryActionKind(mkAccount({ key: "1", handle: "a", muteCount: 1, blockCount: 0 })),
    ).toBe("mute");
    expect(
      primaryActionKind(mkAccount({ key: "1", handle: "a", muteCount: 0, blockCount: 1 })),
    ).toBe("block");
    expect(primaryActionKind(mkAccount({ key: "1", handle: "a" }))).toBe("block");
  });
});

describe("computeSyncStatus", () => {
  test("OBL-03 is 'local' whenever cloud backup is off, regardless of the outbox", () => {
    expect(computeSyncStatus("1", new Set(["1"]), false)).toBe("local");
    expect(computeSyncStatus("1", new Set(), false)).toBe("local");
  });

  test("OBL-04 is 'pending' while queued, 'synced' once drained, when cloud backup is on", () => {
    expect(computeSyncStatus("1", new Set(["1"]), true)).toBe("pending");
    expect(computeSyncStatus("1", new Set(), true)).toBe("synced");
  });
});

describe("formatRelativeShort", () => {
  test("OBL-05 formats now/minutes/hours/days/weeks, including the 59m -> 1h boundary", () => {
    expect(formatRelativeShort(0)).toBe("now");
    expect(formatRelativeShort(59_000)).toBe("now");
    expect(formatRelativeShort(60_000)).toBe("1m");
    expect(formatRelativeShort(59 * 60_000)).toBe("59m");
    expect(formatRelativeShort(60 * 60_000)).toBe("1h");
    expect(formatRelativeShort(23 * 60 * 60_000)).toBe("23h");
    expect(formatRelativeShort(24 * 60 * 60_000)).toBe("1d");
    expect(formatRelativeShort(6 * 24 * 60 * 60_000)).toBe("6d");
    expect(formatRelativeShort(7 * 24 * 60 * 60_000)).toBe("1w");
  });
});

function seedAccounts(
  n: number,
  overrides: (i: number) => Partial<BlockedAccount> = () => ({}),
): void {
  const map: Record<string, BlockedAccount> = {};
  for (let i = 0; i < n; i++) {
    map[String(i)] = mkAccount({
      key: String(i),
      handle: `user_${i}`,
      lastActionAt: 1000 + i,
      blockCount: 1,
      ...overrides(i),
    });
  }
  storageFake.data["blockedAccounts"] = map;
}

function rowsOnScreen(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".xb-opt-table-row"));
}

function footerText(): string {
  return document.querySelector(".xb-opt-footer")?.textContent ?? "";
}

describe("Blocked log pane", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OBL-06 shows the true-empty state with nothing blocked", async () => {
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });
    expect(document.body.textContent).toContain("No blocked accounts yet.");
    expect(document.body.textContent).toContain(
      "Bulk actions from the reply rail will populate this log.",
    );
    expect(footerText()).toContain("0");
  });

  test("OBL-07 renders a small (5-row) table sorted newest-first, with handle/action/when/sync cells", async () => {
    seedAccounts(5);
    await renderBlockedLogPane(document.body, {
      getViewportHeight: () => VIEWPORT_HEIGHT,
      now: () => 1000 + 4 + 90_000, // account 4 (lastActionAt 1004) is 90s old
    });

    const rows = rowsOnScreen();
    expect(rows).toHaveLength(5);
    // newest (highest lastActionAt, i.e. index 4 / user_4) sorts first.
    expect(rows[0]?.textContent).toContain("user_4");
    expect(rows[0]?.textContent).toContain("Block");
    expect(rows[0]?.textContent).toContain("1m");
    expect(rows[0]?.textContent).toContain("Local"); // cloud backup off by default
    expect(footerText()).toContain("5");
    expect(footerText()).toContain("accounts");
  });

  test("OBL-08 a 2000-row list only mounts a small window of DOM rows, and the footer count is comma-grouped", async () => {
    seedAccounts(2000);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => 360 });

    const rendered = rowsOnScreen().length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    expect(footerText()).toContain("2,000");
    expect(footerText()).toContain("accounts");
  });

  test("OBL-09 singular footer count reads '1 account'", async () => {
    seedAccounts(1);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });
    expect(footerText()).toContain("1 account");
    expect(footerText()).not.toContain("1 accounts");
  });

  test("OBL-10 sync status reflects the outbox and the cloud-backup flag", async () => {
    seedAccounts(2);
    storageFake.data["blockedOutbox"] = [{ accountKey: "0" }];
    storageFake.data["cloudBackup"] = true;
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });

    const rows = rowsOnScreen();
    const byHandle = (handle: string) => rows.find((row) => row.textContent?.includes(handle));
    expect(byHandle("user_0")?.textContent).toContain("Pending");
    expect(byHandle("user_1")?.textContent).toContain("Synced");
  });

  test("OBL-11 search filters by handle (debounced)", async () => {
    seedAccounts(3);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });

    const search = document.querySelector<HTMLInputElement>('[aria-label="Search blocked log"]')!;
    search.value = "user_1";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, BLOCKED_LOG_SEARCH_DEBOUNCE_MS + 10));

    expect(rowsOnScreen()).toHaveLength(1);
    expect(rowsOnScreen()[0]?.textContent).toContain("user_1");
  });

  test("OBL-12 action chips filter to Block/Mute, and sync chips filter by sync status", async () => {
    seedAccounts(2, (i) => (i === 0 ? { blockCount: 0, muteCount: 1 } : { blockCount: 1 }));
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [{ accountKey: "0" }];
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });

    function chip(group: string, label: string): HTMLButtonElement {
      const groupEl = document.querySelector(`[aria-label="${group}"]`)!;
      const button = Array.from(groupEl.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent === label,
      );
      if (!button) throw new Error(`no button "${label}" in group "${group}"`);
      return button;
    }

    chip("Filter by action", "Mute").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(rowsOnScreen()).toHaveLength(1);
    expect(rowsOnScreen()[0]?.textContent).toContain("user_0");
    expect(chip("Filter by action", "Mute").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Filter by action", "All").getAttribute("aria-pressed")).toBe("false");

    chip("Filter by action", "All").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    chip("Filter by sync status", "Pending").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(rowsOnScreen()).toHaveLength(1);
    expect(rowsOnScreen()[0]?.textContent).toContain("user_0");
  });

  test("OBL-13 shows a filtered-empty state distinct from the true-empty state", async () => {
    seedAccounts(2);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });

    const search = document.querySelector<HTMLInputElement>('[aria-label="Search blocked log"]')!;
    search.value = "nobody-matches-this";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, BLOCKED_LOG_SEARCH_DEBOUNCE_MS + 10));

    expect(document.body.textContent).toContain("No accounts match these filters.");
    expect(document.body.textContent).toContain("Try a different search or filter.");
  });

  test("OBL-14 Export JSON hands a handle/action/lastActionAt/sync projection to the download seam", async () => {
    seedAccounts(2);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });

    const originalCreate = URL.createObjectURL.bind(URL);
    let capturedBlob: Blob | undefined;
    URL.createObjectURL = ((blob: Blob) => {
      capturedBlob = blob;
      return originalCreate(blob);
    }) as typeof URL.createObjectURL;
    try {
      const exportButton = Array.from(document.querySelectorAll("button")).find(
        (btn) => btn.textContent === "Export JSON",
      )!;
      exportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleMicrotasks();
      const text = await capturedBlob?.text();
      expect(text).toContain('"handle": "user_0"');
      expect(text).toContain('"sync": "local"');
    } finally {
      URL.createObjectURL = originalCreate;
    }
  });

  test("OBL-15 roving tabindex: only the focused row is tab-reachable, and j/k or arrow keys move focus", async () => {
    seedAccounts(3);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });

    const scroll = document.querySelector<HTMLElement>(".xb-opt-table-scroll")!;
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([0, -1, -1]);

    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([-1, 0, -1]);

    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([-1, -1, 0]);

    // clamps at the bottom edge.
    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([-1, -1, 0]);

    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
    );
    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([0, -1, -1]);

    // clamps at the top edge.
    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  test("OBL-16 ignores modified key chords and unrelated keys", async () => {
    seedAccounts(3);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => VIEWPORT_HEIGHT });
    const scroll = document.querySelector<HTMLElement>(".xb-opt-table-scroll")!;

    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([0, -1, -1]);

    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(rowsOnScreen().map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  test("OBL-17 keyboard navigation scrolls a focused row into view when it's outside the viewport", async () => {
    seedAccounts(50);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => 72 }); // 2 rows visible at 36px

    const scroll = document.querySelector<HTMLElement>(".xb-opt-table-scroll")!;
    expect(scroll.scrollTop).toBe(0);

    for (let i = 0; i < 5; i++) {
      scroll.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
      );
    }
    // Row index 5's bottom (216px) now exceeds scrollTop(0) + viewport(72), so the view
    // must have scrolled down to keep the focused row visible.
    expect(scroll.scrollTop).toBeGreaterThan(0);

    const scrolledDownTop = scroll.scrollTop;
    for (let i = 0; i < 5; i++) {
      scroll.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }),
      );
    }
    expect(scroll.scrollTop).toBeLessThan(scrolledDownTop);
  });

  test("OBL-18 the jump-to-top control appears past the scroll threshold and resets scrollTop", async () => {
    seedAccounts(200);
    await renderBlockedLogPane(document.body, { getViewportHeight: () => 360 });

    const scroll = document.querySelector<HTMLElement>(".xb-opt-table-scroll")!;
    const jumpButton = document.querySelector<HTMLButtonElement>(".xb-opt-jump-top")!;
    expect(jumpButton.hidden).toBe(true);

    scroll.scrollTop = JUMP_TO_TOP_THRESHOLD + 1;
    scroll.dispatchEvent(new Event("scroll"));
    expect(jumpButton.hidden).toBe(false);

    jumpButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(scroll.scrollTop).toBe(0);

    scroll.dispatchEvent(new Event("scroll"));
    expect(jumpButton.hidden).toBe(true);
  });

  test("OBL-19 destroy() tears down listeners and the live counter without throwing", async () => {
    seedAccounts(5);
    const handle = await renderBlockedLogPane(document.body, {
      getViewportHeight: () => VIEWPORT_HEIGHT,
    });
    expect(() => handle.destroy()).not.toThrow();
  });

  test("OBL-20 destroy() is also safe when the list never left the empty state (no table was ever built)", async () => {
    const handle = await renderBlockedLogPane(document.body, {
      getViewportHeight: () => VIEWPORT_HEIGHT,
    });
    expect(() => handle.destroy()).not.toThrow();
  });
});
