// Catalog: PU-* (renderPopup shell, stat strip, toggles, footer). The sync-age formatter
// moved to sync-engine (formatSyncAge, tested there as OC-01); the popup's sync-row
// wiring lives in cloud-backup.test.ts (PU-CB-*).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ANIMATE_MS, type LiveNumberClock } from "../../entrypoints/lib/live-number.ts";
import {
  mountPopupIfPresent,
  renderPopup as renderPopupBase,
  type RenderPopupOptions,
} from "../../entrypoints/popup/main.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

function cloudTestOptions(overrides: RenderPopupOptions = {}): RenderPopupOptions {
  return {
    probeConfigured: async () => false,
    loadAdapter: async () => {
      throw new Error("test must not load the cloud adapter");
    },
    ...overrides,
  };
}

function renderPopup(root: HTMLElement, opts: RenderPopupOptions = {}): Promise<void> {
  return renderPopupBase(root, cloudTestOptions(opts));
}

/** A fully injected fake clock (mirrors test/live-number.test.ts's): requestFrame/
 *  setTimeout just queue callbacks for the test to fire explicitly, so a storage-driven
 *  delta's 100ms debounce + 180ms animation never depends on real timers. */
function createFakeClock(): {
  clock: LiveNumberClock;
  frames: FrameRequestCallback[];
  timeouts: Array<{ id: number; run: () => void }>;
} {
  const frames: FrameRequestCallback[] = [];
  const timeouts: Array<{ id: number; run: () => void }> = [];
  let frameId = 0;
  let timeoutId = 0;
  const clock: LiveNumberClock = {
    requestFrame: (callback) => {
      frames.push(callback);
      return ++frameId;
    },
    cancelFrame: () => {},
    setTimeout: (callback) => {
      const id = ++timeoutId;
      timeouts.push({ id, run: callback });
      return id;
    },
    clearTimeout: () => {},
  };
  return { clock, frames, timeouts };
}

/** A minimal active BlockedAccount map entry for stat-strip tests. */
function seedAccount(key: string, counts: { blockCount: number; muteCount: number }): unknown {
  return {
    key,
    handle: `user_${key}`,
    idUnknown: false,
    xUserId: key,
    firstActionAt: 1,
    lastActionAt: 1,
    status: "active",
    actions: [],
    ...counts,
  };
}

function statValues(): string[] {
  return Array.from(document.querySelectorAll(".xb-stat-value")).map(
    (node) => node.textContent ?? "",
  );
}

function seedSettings(overrides: {
  confirmDestructiveActions?: boolean;
  keyboardMode?: boolean;
  maxReplies?: unknown;
  protectWhitelist?: boolean;
}): void {
  storageFake.data["settings"] = overrides;
}

/** Reads the persisted `settings.maxReplies`, narrowing the storage fake's
 *  untyped record instead of asserting its shape. */
function storedMaxReplies(): number {
  const settings = storageFake.data["settings"];
  if (typeof settings === "object" && settings !== null && "maxReplies" in settings) {
    const { maxReplies } = settings;
    if (typeof maxReplies === "number") return maxReplies;
  }
  throw new Error("settings.maxReplies missing or not a number");
}

describe("renderPopup structure", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PU-01 renders the shell: brand, status, stat labels, toggle labels, footer", async () => {
    await renderPopup(document.body);
    const popup = document.querySelector('[data-xb-surface="popup"]')!;
    expect(popup.querySelector("h1")?.textContent).toBe("XBlocker");
    expect(popup.textContent).toContain("Protecting x.com");
    expect(popup.textContent).toContain("Blocked");
    expect(popup.textContent).toContain("Muted");
    expect(popup.textContent).toContain("Whitelisted");
    expect(popup.textContent).toContain("Protect whitelist");
    expect(popup.textContent).toContain("Whitelisted handles are skipped during bulk actions.");
    expect(popup.textContent).toContain("Confirm destructive actions");
    expect(popup.textContent).toContain("Ask before removing whitelist entries.");
    expect(popup.textContent).toContain("Open settings");
  });

  test("PU-02 injects popup styles exactly once across renders", async () => {
    await renderPopup(document.body);
    await renderPopup(document.body);
    expect(document.querySelectorAll("#xblocker-popup-styles")).toHaveLength(1);
  });

  test("PU-03 replaces previous content on re-render (no duplicate popups)", async () => {
    await renderPopup(document.body);
    await renderPopup(document.body);
    expect(document.querySelectorAll('[data-xb-surface="popup"]')).toHaveLength(1);
  });

  test("PU-04 the sync button's reserved width is shipped in the stylesheet", async () => {
    await renderPopup(document.body);
    const css = document.getElementById("xblocker-popup-styles")?.textContent ?? "";
    // "Sync now" <-> "Syncing…" must never reflow neighbors — pin the reserved-width rule.
    expect(css).toContain("min-width: 9ch");
  });

  test("PU-05 mounts synchronously with no entrance animation (no rAF/timer scheduled)", async () => {
    let rafCalls = 0;
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCalls += 1;
      return originalRaf.call(window, cb);
    }) as typeof window.requestAnimationFrame;
    try {
      storageFake.data["blockedAccounts"] = {
        "1": seedAccount("1", { blockCount: 3, muteCount: 2 }),
      };
      await renderPopup(document.body);
      // The first set() on each stat's live number renders instantly (mount contract),
      // so no animation frame is ever scheduled for the initial paint.
      expect(rafCalls).toBe(0);
      // stats() rolls up DISTINCT ACTIVE ACCOUNTS with a nonzero count, not raw action
      // counts (see summarizeAccounts in blocked-merge.ts) — one account with
      // blockCount 3 / muteCount 2 is still exactly one blocked + one muted account.
      expect(statValues()).toEqual(["1", "1", "0"]);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });
});

describe("popup stat strip", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PU-07 shows the real blocked/muted/whitelisted counts on mount", async () => {
    storageFake.data["blockedAccounts"] = {
      "1": seedAccount("1", { blockCount: 2, muteCount: 0 }),
      "2": seedAccount("2", { blockCount: 0, muteCount: 1 }),
      "3": seedAccount("3", { blockCount: 1, muteCount: 1 }),
    };
    storageFake.data["whitelist"] = ["trusted_user"];

    await renderPopup(document.body);

    // blocked: accounts 1+3, muted: accounts 2+3, whitelist: 1 entry.
    expect(statValues()).toEqual(["2", "2", "1"]);
  });

  test("PU-08 falls back to zero counts with nothing stored", async () => {
    await renderPopup(document.body);
    expect(statValues()).toEqual(["0", "0", "0"]);
  });

  test("PU-09 a block recorded while the popup is open updates the blocked/muted cards live", async () => {
    type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    const listeners: ChangeListener[] = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install a runtime onChanged fake the static chrome typings don't model.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    chromeStorage["onChanged"] = {
      addListener: (fn: ChangeListener) => listeners.push(fn),
      removeListener: () => {},
    };
    try {
      const { clock, frames, timeouts } = createFakeClock();
      await renderPopup(document.body, { clock });
      expect(statValues()).toEqual(["0", "0", "0"]);

      const map = { "9": seedAccount("9", { blockCount: 1, muteCount: 0 }) };
      for (const listener of listeners) listener({ blockedAccounts: { newValue: map } }, "local");

      // A real delta never repaints synchronously (see live-number.ts): it debounces
      // 100ms then animates 180ms. The blocked cell moved 0 -> 1 (one timeout); the
      // muted cell stayed at 0, a no-op that schedules nothing.
      expect(statValues()).toEqual(["0", "0", "0"]);
      expect(timeouts).toHaveLength(1);
      timeouts[0]?.run();
      frames[0]?.(0);
      frames[1]?.(ANIMATE_MS);

      expect(statValues()).toEqual(["1", "0", "0"]);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
    }
  });
});

describe("popup settings toggles", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  function toggles(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>(".xb-switch"));
  }

  test("PU-10 reflects stored setting values on the toggles", async () => {
    seedSettings({ confirmDestructiveActions: false, protectWhitelist: false });
    await renderPopup(document.body);
    // Order matches buildToggles: protect, confirm.
    expect(toggles().map((toggle) => toggle.checked)).toEqual([false, false]);
  });

  test("PU-11 falls back to default settings when none are stored", async () => {
    await renderPopup(document.body);
    expect(toggles().map((toggle) => toggle.checked)).toEqual([true, true]);
  });

  test("PU-12 toggling protectWhitelist persists the full 4-key settings object", async () => {
    await renderPopup(document.body);
    const [protectToggle] = toggles();
    protectToggle!.checked = false;
    protectToggle!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 50,
      protectWhitelist: false,
    });
  });

  test("PU-13 toggling confirmDestructiveActions persists the full 4-key settings object", async () => {
    await renderPopup(document.body);
    const [, confirmToggle] = toggles();
    confirmToggle!.checked = false;
    confirmToggle!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: false,
      keyboardMode: false,
      maxReplies: 50,
      protectWhitelist: true,
    });
  });

  test("PU-14 a stored keyboardMode/maxReplies pass through untouched when a toggle saves", async () => {
    seedSettings({ keyboardMode: true, maxReplies: 75 });
    await renderPopup(document.body);
    const [protectToggle] = toggles();
    protectToggle!.checked = false;
    protectToggle!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: true,
      maxReplies: 75,
      protectWhitelist: false,
    });
  });

  test("PU-15 an out-of-range stored maxReplies is clamped before it's ever resaved", async () => {
    seedSettings({ maxReplies: 999 });
    await renderPopup(document.body);
    const [protectToggle] = toggles();
    protectToggle!.checked = false;
    protectToggle!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storedMaxReplies()).toBe(200);
  });
});

describe("popup footer", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  afterEach(() => {
    delete (chrome.runtime as { openOptionsPage?: () => void }).openOptionsPage;
  });

  test("PU-16 clicking 'Open settings' calls chrome.runtime.openOptionsPage when present", async () => {
    let calls = 0;
    (chrome.runtime as { openOptionsPage?: () => void }).openOptionsPage = () => {
      calls += 1;
    };
    await renderPopup(document.body);
    document
      .querySelector<HTMLButtonElement>(".xb-footer-button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(calls).toBe(1);
  });

  test("PU-17 clicking 'Open settings' never throws when openOptionsPage is absent (test mock)", async () => {
    await renderPopup(document.body);
    expect(() => {
      document
        .querySelector<HTMLButtonElement>(".xb-footer-button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).not.toThrow();
  });
});

describe("mountPopupIfPresent", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PU-18 auto-renders into #app when mounted", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);

    mountPopupIfPresent(cloudTestOptions());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.querySelector('[data-xb-surface="popup"]')).toBeTruthy();
  });

  test("PU-19 does nothing when #app is absent", () => {
    expect(() => mountPopupIfPresent(cloudTestOptions())).not.toThrow();
    expect(document.querySelector('[data-xb-surface="popup"]')).toBeNull();
  });
});
