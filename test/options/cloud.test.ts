// Catalog: OC-* (Cloud backup pane: unconfigured state, telltale/meta rows, sync now,
// and the WIPE danger zone). The shared formatSyncAge formatter moved to sync-engine and
// is tested there (OC-01).
//
// The pane takes the cloud transport as a `loadAdapter` port (ADR-0003), so these tests
// inject a plain CloudAdapter fake with call recording — the same seam the popup sync-row
// suite and the engine tests use. No bun module-path mocking: convex-sync (which talks to
// a live Convex deployment, see its header) is never loaded here.
import { beforeEach, describe, expect, test } from "bun:test";

import { renderCloudPane, WIPE_CONFIRM_WORD } from "../../entrypoints/options/panes/cloud.ts";
import { renderOptions } from "../../entrypoints/options/main.ts";
import { makeCloudAdapterFake } from "../helpers/cloud-adapter-fake.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

let fake: ReturnType<typeof makeCloudAdapterFake>;

/** Render the pane with the fake adapter injected as its cloud port. */
function renderPane(opts: { now?: () => number } = {}): Promise<{ destroy(): void }> {
  return renderCloudPane(document.body, { ...opts, loadAdapter: async () => fake.adapter });
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

describe("Cloud backup pane (unconfigured build)", () => {
  beforeEach(() => {
    resetTestEnvironment();
    fake = makeCloudAdapterFake();
    fake.state.configured = false;
  });

  test("OC-02 renders a single explained-disabled state with no live controls", async () => {
    const handle = await renderPane();

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
    fake = makeCloudAdapterFake();
  });

  test("OC-03 backup off by default: Off / Never synced. / 0 pending", async () => {
    const handle = await renderPane({ now: () => 1_000_000 });
    expect(document.querySelector<HTMLInputElement>(".xb-opt-switch")?.checked).toBe(false);
    expect(rowValues()).toEqual(["Off", "Never synced.", "0"]);
    expect(() => handle.destroy()).not.toThrow();
  });

  test("OC-04 toggling on persists cloudBackup immediately, without triggering a sync", async () => {
    await renderPane();
    const toggle = document.querySelector<HTMLInputElement>(".xb-opt-switch")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storageFake.data["cloudBackup"]).toBe(true);
    expect(rowValues()[0]).toBe("On");
    expect(fake.calls).toEqual({ push: 0, pull: 0, clear: 0 });
  });

  test("OC-05 Sync now shows a busy state mid-flight, then reports the fresh sync time and pending count", async () => {
    let resolvePull: (() => void) | undefined;
    fake.state.pull = () =>
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

    await renderPane({ now: () => 999 });
    const syncButton = byButtonText("Sync now");

    syncButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);
    expect(syncButton.disabled).toBe(true);
    expect(syncButton.textContent).toBe("Syncing…");

    resolvePull?.();
    await settleMicrotasks(50);

    expect(syncButton.disabled).toBe(false);
    expect(syncButton.textContent).toBe("Sync now");
    expect(fake.calls.push).toBe(1);
    expect(fake.calls.pull).toBe(1);
    expect(rowValues()).toEqual(["On", "Synced just now.", "0"]);
  });

  test("OC-06 a sync failure surfaces 'Sync failed' and it is not immediately clobbered", async () => {
    fake.state.pull = async () => {
      throw new Error("network boom");
    };
    await renderPane();
    const syncButton = byButtonText("Sync now");

    syncButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);

    expect(rowValues()[0]).toBe("Sync failed");
    expect(syncButton.disabled).toBe(false);
    expect(syncButton.textContent).toBe("Sync now");
  });

  test("OC-07 the wipe gate stays disabled until the trimmed, case-insensitive word matches", async () => {
    await renderPane();
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
    await renderPane({ now: () => 999 });
    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    input.value = WIPE_CONFIRM_WORD;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    byText("button", "Confirm wipe").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(50);

    expect(fake.calls.clear).toBe(1);
    expect(storageFake.data["cloudSyncMeta"]).toEqual({});
    expect(document.querySelector(".xb-opt-wipe-panel")?.getAttribute("data-open")).toBe("false");
    expect(rowValues()[1]).toBe("Never synced.");
  });

  test("OC-09 Cancel closes the panel and clears the input without wiping anything", async () => {
    await renderPane();
    byText("button", "Wipe cloud data").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Type WIPE to confirm"]')!;
    input.value = WIPE_CONFIRM_WORD;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    byText("button", "Cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".xb-opt-wipe-panel")?.getAttribute("data-open")).toBe("false");
    expect(input.value).toBe("");
    expect(fake.calls.clear).toBe(0);
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
    await renderPane({ now: () => 999 });
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
    expect(fake.calls.push).toBe(0);
  });

  test("OC-10 a wipe failure shows an inline error and re-enables the gate", async () => {
    fake.state.clear = async () => {
      throw new Error("wipe boom");
    };
    await renderPane();
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
    fake = makeCloudAdapterFake();
  });

  test("OC-11 navigating to Cloud backup from the rail mounts this pane", async () => {
    await renderOptions(document.body);
    document
      .querySelector<HTMLAnchorElement>('.xb-opt-nav-item[data-route="cloud"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settleMicrotasks(50);

    expect(document.querySelector(".xb-opt-content h1")?.textContent).toBe("Cloud backup");
  });
});
