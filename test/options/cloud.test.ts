// Catalog: OC-* (Cloud backup pane: unconfigured state, telltale/meta rows, sync now,
// and the WIPE danger zone).
//
import { beforeEach, describe, expect, test } from "bun:test";

import type { RemoteAccount } from "../../entrypoints/lib/blocked-store.ts";
import type { RenderCloudPaneOptions } from "../../entrypoints/options/panes/cloud.ts";
import {
  formatSyncAge,
  renderCloudPane,
  WIPE_CONFIRM_WORD,
} from "../../entrypoints/options/panes/cloud.ts";
import { renderOptions } from "../../entrypoints/options/main.ts";
import type { CloudAdapter } from "../../entrypoints/lib/sync-engine.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

type OutboxLike = { action: { actionId: string } };

let configured: boolean;
let pushOutboxImpl: (items: OutboxLike[]) => Promise<string[]>;
let pullBlockedImpl: () => Promise<RemoteAccount[]>;
let clearCloudImpl: () => Promise<void>;
let calls: { push: number; pull: number; clear: number };

const adapter: CloudAdapter = {
  isConfigured: () => configured,
  async push(items) {
    calls.push += 1;
    return pushOutboxImpl(items);
  },
  async pull() {
    calls.pull += 1;
    return pullBlockedImpl();
  },
};

function cloudOptions(overrides: Pick<RenderCloudPaneOptions, "now"> = {}): RenderCloudPaneOptions {
  return {
    ...overrides,
    probeConfigured: async () => configured,
    loadAdapter: async () => adapter,
    clearCloud: async () => {
      calls.clear += 1;
      await clearCloudImpl();
    },
  };
}

function byText(tag: string, text: string): HTMLElement {
  const el = Array.from(document.querySelectorAll<HTMLElement>(tag)).find(
    (node) => node.textContent === text,
  );
  if (!el) throw new Error(`no <${tag}> with text "${text}"`);
  return el;
}

function byButtonText(text: string): HTMLButtonElement {
  const el = byText("button", text);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`"${text}" is not a <button>`);
  return el;
}

function rowValues(): string[] {
  return Array.from(document.querySelectorAll(".xb-opt-row-value")).map(
    (el) => el.textContent ?? "",
  );
}

function wipeResultText(): string {
  const panel = document.querySelector(".xb-opt-wipe-panel")!;
  const captions = panel.querySelectorAll(".xb-opt-field-caption");
  return captions[1]?.textContent ?? "";
}

async function waitForHeading(text: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (document.querySelector(".xb-opt-content h1")?.textContent === text) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`heading did not become "${text}"`);
}

describe("formatSyncAge", () => {
  test("OC-01 formats never/just-now/minutes/hours/days", () => {
    const now = 10 * 24 * 60 * 60_000;
    expect(formatSyncAge({}, now)).toBe("Never synced.");
    expect(formatSyncAge({ lastSyncAt: now - 10_000 }, now)).toBe("Synced just now.");
    expect(formatSyncAge({ lastSyncAt: now - 5 * 60_000 }, now)).toBe("Synced 5m ago.");
    expect(formatSyncAge({ lastSyncAt: now - 3 * 60 * 60_000 }, now)).toBe("Synced 3h ago.");
    expect(formatSyncAge({ lastSyncAt: now - 2 * 24 * 60 * 60_000 }, now)).toBe("Synced 2d ago.");
  });
});

describe("Cloud backup pane (unconfigured build)", () => {
  beforeEach(() => {
    resetTestEnvironment();
    configured = false;
  });

  test("OC-02 renders a single explained-disabled state with no live controls", async () => {
    const handle = await renderCloudPane(document.body, cloudOptions());

    expect(document.querySelector("h1")?.textContent).toBe("Cloud backup");
    expect(document.body.textContent).toContain("Cloud backup isn't configured for this build.");
    expect(document.querySelectorAll(".xb-opt-switch")).toHaveLength(0);
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(() => handle.destroy()).not.toThrow();
  });
});

describe("Cloud backup pane (configured)", () => {
  beforeEach(() => {
    resetTestEnvironment();
    configured = true;
    pushOutboxImpl = async (items) => items.map((item) => item.action.actionId);
    pullBlockedImpl = async () => [];
    clearCloudImpl = async () => {};
    calls = { push: 0, pull: 0, clear: 0 };
  });

  test("OC-03 backup off by default: Off / Never synced. / 0 pending", async () => {
    const handle = await renderCloudPane(document.body, cloudOptions({ now: () => 1_000_000 }));
    expect(document.querySelector<HTMLInputElement>(".xb-opt-switch")?.checked).toBe(false);
    expect(rowValues()).toEqual(["Off", "Never synced.", "0"]);
    expect(() => handle.destroy()).not.toThrow();
  });

  test("OC-04 toggling on persists cloudBackup immediately, without triggering a sync", async () => {
    await renderCloudPane(document.body, cloudOptions());
    const toggle = document.querySelector<HTMLInputElement>(".xb-opt-switch")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storageFake.data["cloudBackup"]).toBe(true);
    expect(rowValues()[0]).toBe("On");
    expect(calls).toEqual({ push: 0, pull: 0, clear: 0 });
  });

  test("OC-05 Sync now shows a busy state mid-flight, then reports the fresh sync time and pending count", async () => {
    let resolvePull: (() => void) | undefined;
    pullBlockedImpl = () =>
      new Promise((resolve) => {
        resolvePull = () => resolve([]);
      });
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];
    storageFake.data["cloudBackup"] = true;

    await renderCloudPane(document.body, cloudOptions({ now: () => 999 }));
    const syncButton = byButtonText("Sync now");

    syncButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);
    expect(syncButton.disabled).toBe(true);
    expect(syncButton.textContent).toBe("Syncing…");

    resolvePull?.();
    await settleMicrotasks(50);

    expect(syncButton.disabled).toBe(false);
    expect(syncButton.textContent).toBe("Sync now");
    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
    expect(rowValues()).toEqual(["On", "Synced just now.", "0"]);
  });

  test("OC-06 a sync failure surfaces 'Sync failed' and it is not immediately clobbered", async () => {
    pullBlockedImpl = async () => {
      throw new Error("network boom");
    };
    await renderCloudPane(document.body, cloudOptions());
    const syncButton = byButtonText("Sync now");

    syncButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);

    expect(rowValues()[0]).toBe("Sync failed");
    expect(syncButton.disabled).toBe(false);
    expect(syncButton.textContent).toBe("Sync now");
  });

  test("OC-07 the wipe gate stays disabled until the trimmed, case-insensitive word matches", async () => {
    await renderCloudPane(document.body, cloudOptions());
    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    const confirmButton = byButtonText("Confirm wipe");
    expect(document.querySelector(".xb-opt-wipe-panel")?.getAttribute("data-open")).toBe("true");
    expect(confirmButton.disabled).toBe(true);

    input.value = "nope";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(confirmButton.disabled).toBe(true);

    input.value = ` ${WIPE_CONFIRM_WORD.toLowerCase()} `;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(confirmButton.disabled).toBe(false);
  });

  test("OC-08 confirming the wipe clears the cloud, resets sync meta, and closes the panel", async () => {
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: 12345 };
    await renderCloudPane(document.body, cloudOptions({ now: () => 999 }));
    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    input.value = WIPE_CONFIRM_WORD;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    byText("button", "Confirm wipe").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);

    expect(calls.clear).toBe(1);
    expect(storageFake.data["cloudSyncMeta"]).toEqual({});
    expect(document.querySelector(".xb-opt-wipe-panel")?.getAttribute("data-open")).toBe("false");
    expect(rowValues()[1]).toBe("Never synced.");
  });

  test("OC-09 Cancel closes the panel and clears the input without wiping anything", async () => {
    await renderCloudPane(document.body, cloudOptions());
    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    input.value = WIPE_CONFIRM_WORD;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    byText("button", "Cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".xb-opt-wipe-panel")?.getAttribute("data-open")).toBe("false");
    expect(input.value).toBe("");
    expect(calls.clear).toBe(0);
  });

  test("OC-12 confirming the wipe drains the pending outbox, turns cloud backup off, and updates the UI", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];
    await renderCloudPane(document.body, cloudOptions({ now: () => 999 }));
    expect(rowValues()).toEqual(["On", "Never synced.", "1"]);

    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    input.value = WIPE_CONFIRM_WORD;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    byText("button", "Confirm wipe").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);

    // The outbox is drained so the actions that produced the wiped rows never re-push.
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    // A wiped cloud with backup left on would just refill on the next auto-sync.
    expect(storageFake.data["cloudBackup"]).toBe(false);
    expect(document.querySelector<HTMLInputElement>(".xb-opt-switch")?.checked).toBe(false);
    expect(rowValues()).toEqual(["Off", "Never synced.", "0"]);

    // Nothing queued means a subsequent manual sync has nothing to push.
    byButtonText("Sync now").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);
    expect(calls.push).toBe(0);
  });

  test("OC-10 a wipe failure shows an inline error and re-enables the gate", async () => {
    clearCloudImpl = async () => {
      throw new Error("wipe boom");
    };
    await renderCloudPane(document.body, cloudOptions());
    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    input.value = WIPE_CONFIRM_WORD;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const confirmButton = byButtonText("Confirm wipe");
    const cancelButton = byButtonText("Cancel");
    confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);

    expect(wipeResultText()).toBe("Wipe failed: wipe boom");
    expect(cancelButton.disabled).toBe(false);
    expect(confirmButton.disabled).toBe(false); // input still holds the matching word
    expect(document.querySelector(".xb-opt-wipe-panel")?.getAttribute("data-open")).toBe("true");
  });
});

describe("Cloud route via the full options shell", () => {
  beforeEach(() => {
    resetTestEnvironment();
    configured = true;
    pushOutboxImpl = async () => [];
    pullBlockedImpl = async () => [];
    clearCloudImpl = async () => {};
    calls = { push: 0, pull: 0, clear: 0 };
  });

  test("OC-11 navigating to Cloud backup from the rail mounts this pane", async () => {
    await renderOptions(document.body);
    document
      .querySelector<HTMLAnchorElement>('.xb-opt-nav-item[data-route="cloud"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitForHeading("Cloud backup");

    expect(document.querySelector(".xb-opt-content h1")?.textContent).toBe("Cloud backup");
  });
});
