// Catalog: PU-CB-* (cloud backup toggle, sync control, runCloudSync).
//
// convex-sync talks to a live Convex deployment (see its header) and is intentionally
// excluded from unit tests. We mock it at the popup boundary so the popup's sync wiring
// is exercised without pulling in the real adapter. There is no auth in this flow.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type OutboxLike = { action: { actionId: string } };

let configured: boolean;
let pushOutboxImpl: (items: OutboxLike[]) => Promise<string[]>;
let pullBlockedImpl: () => Promise<unknown[]>;
let calls: { push: number; pull: number };

await mock.module("../../entrypoints/lib/convex-sync", () => ({
  isCloudConfigured: () => configured,
  pushOutbox: async (items: OutboxLike[]) => {
    calls.push += 1;
    return pushOutboxImpl(items);
  },
  pullBlocked: async () => {
    calls.pull += 1;
    return pullBlockedImpl();
  },
}));

const { renderPopup } = await import("../../entrypoints/popup/main.ts");
const { resetTestEnvironment, storageFake } = await import("../setup.ts");

/** The "Cloud backup" <section>, located by its heading. */
function cloudSection(): HTMLElement {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".xb-popup-section"));
  const section = sections.find((node) => node.querySelector("h2")?.textContent === "Cloud backup");
  if (!section) throw new Error("Cloud backup section was not rendered");
  return section;
}

/** Drain microtasks queued by the fire-and-forget sync handlers. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// mock.module is process-global; restore it so a later popup test that triggers sync
// binds to the real adapter rather than this fake.
afterAll(() => {
  mock.restore();
});

describe("popup cloud backup", () => {
  beforeEach(() => {
    resetTestEnvironment();
    configured = true;
    pushOutboxImpl = async (items) => items.map((item) => item.action.actionId);
    pullBlockedImpl = async () => [];
    calls = { push: 0, pull: 0 };
  });

  test("PU-CB-01 enabling backup drains the outbox and pulls remote state", async () => {
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        xUserId: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-cloud-switch")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(cloudSection().textContent).toContain("Backed up to your Convex");
    expect(storageFake.data["cloudBackup"]).toBe(true);
  });

  test("PU-CB-02 disabling backup reports off and runs no sync", async () => {
    storageFake.data["cloudBackup"] = true;
    // A fresh sync stamp and an empty outbox: opening the popup rests on the idle
    // status instead of auto-syncing (that path is pinned by PU-CB-07/08).
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };
    await renderPopup(document.body);
    await flush();
    expect(cloudSection().textContent).toContain("synced just now");

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-cloud-switch")!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);
    expect(cloudSection().textContent).toContain("device only");
    expect(storageFake.data["cloudBackup"]).toBe(false);
  });

  test("PU-CB-03 the Sync now button pushes and pulls", async () => {
    await renderPopup(document.body);

    const syncButton = cloudSection().querySelector<HTMLButtonElement>(".xb-button")!;
    syncButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    // Outbox is empty here, so no push, but the pull + merge still runs.
    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(1);
    expect(cloudSection().textContent).toContain("Backed up to your Convex");
  });

  test("PU-CB-04 reports when cloud backup is not configured", async () => {
    configured = false;
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-cloud-switch")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Not configured");
    expect(calls.pull).toBe(0);
  });

  test("PU-CB-05 surfaces a sync error raised from the toggle", async () => {
    pullBlockedImpl = async () => {
      throw new Error("network boom");
    };
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-cloud-switch")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Backup error: network boom");
  });

  test("PU-CB-06 surfaces a sync error raised from the Sync now button", async () => {
    pullBlockedImpl = async () => {
      throw new Error("button boom");
    };
    await renderPopup(document.body);

    const syncButton = cloudSection().querySelector<HTMLButtonElement>(".xb-button")!;
    syncButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Backup error: button boom");
  });

  test("PU-CB-07 opening the popup with backup on and a queued outbox syncs immediately", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() }; // fresh, yet pending wins
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        xUserId: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];

    await renderPopup(document.body);
    await flush();

    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(cloudSection().textContent).toContain("Backed up to your Convex. Pushed 1.");
  });

  test("PU-CB-08 opening the popup with a stale last sync pulls even with nothing queued", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() - 16 * 60_000 };

    await renderPopup(document.body);
    await flush();

    expect(calls.push).toBe(0); // nothing queued -> no push round-trip
    expect(calls.pull).toBe(1);
    expect(cloudSection().textContent).toContain("Backed up to your Convex.");
  });

  test("PU-CB-09 an auto-sync failure on open surfaces as a backup error", async () => {
    storageFake.data["cloudBackup"] = true;
    pullBlockedImpl = async () => {
      throw new Error("open boom");
    };

    await renderPopup(document.body);
    await flush();

    expect(cloudSection().textContent).toContain("Backup error: open boom");
  });
});
