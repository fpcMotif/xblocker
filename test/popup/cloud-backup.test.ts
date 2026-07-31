// Catalog: PU-CB-* (popup sync row: mount state, manual "Sync now", auto-sync on open,
// error surfacing, unconfigured build). See docs/plans/2026-07-10-gauge-and-ledger/plan.md,
// "Sync row" — the popup has no enable/disable toggle of its own (that lives on the
// settings page); it only ever observes the stored `cloudBackup` flag and offers the one
// action that is actually available for the state it finds.
//
import { beforeEach, describe, expect, test } from "bun:test";

import type { RemoteAccount } from "../../packages/storage/blocked-store.ts";
import type { CloudAdapter } from "../../packages/sync/sync-engine.ts";
import { renderPopup } from "../../entrypoints/popup/main.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

type OutboxLike = { action: { actionId: string } };

let configured: boolean;
let pushOutboxImpl: (items: OutboxLike[]) => Promise<string[]>;
let pullBlockedImpl: () => Promise<RemoteAccount[]>;
let calls: { push: number; pull: number };
let probeCalls: number;
let autoGateLoadAdapterCalls: number;

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
  async clear() {},
};

function cloudOptions() {
  return {
    probeConfigured: async () => {
      probeCalls += 1;
      return configured;
    },
    loadAdapter: async () => {
      autoGateLoadAdapterCalls += 1;
      return adapter;
    },
  };
}

/** Drain the microtask/macrotask queue so the fire-and-forget mount-time sync handler
 *  (and any click-triggered one) settles before assertions run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The lean popup's one sync region — see main.ts's buildSyncRow. */
function syncRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>(".xb-sync-row");
  if (!row) throw new Error("sync row was not rendered");
  return row;
}

function telltaleState(): string | undefined {
  return syncRow().querySelector<HTMLElement>(".xb-telltale")?.dataset["state"];
}

function syncTitle(): string {
  return syncRow().querySelector(".xb-sync-title")?.textContent ?? "";
}

function syncDetail(): string {
  return syncRow().querySelector(".xb-sync-detail")?.textContent ?? "";
}

function syncButton(): HTMLButtonElement | null {
  return syncRow().querySelector<HTMLButtonElement>(".xb-sync-button");
}

function turnOnLink(): HTMLButtonElement | null {
  return syncRow().querySelector<HTMLButtonElement>(".xb-ghost-link");
}

function unconfiguredNote(): HTMLElement | null {
  return syncRow().querySelector<HTMLElement>(".xb-sync-note");
}

function outboxItem(actionId: string): unknown {
  return {
    accountKey: "1",
    xUserId: "1",
    handle: "spammer",
    idUnknown: false,
    action: { actionId, kind: "block", at: 1, source: "reply-bar" },
  };
}

describe("popup cloud sync row", () => {
  beforeEach(() => {
    resetTestEnvironment();
    configured = true;
    pushOutboxImpl = async (items) => items.map((item) => item.action.actionId);
    pullBlockedImpl = async () => [];
    calls = { push: 0, pull: 0 };
    probeCalls = 0;
    autoGateLoadAdapterCalls = 0;
  });

  test("PU-CB-01 backup on with a queued outbox auto-syncs on open, draining the outbox", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [outboxItem("a1")];

    await renderPopup(document.body, cloudOptions());
    await flush();

    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(telltaleState()).toBe("idle");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Synced just now.");
  });

  test("PU-CB-02 backup off never syncs, and its only affordance opens settings", async () => {
    storageFake.data["blockedOutbox"] = [outboxItem("a1")];
    let opened = 0;
    (chrome.runtime as { openOptionsPage?: () => void }).openOptionsPage = () => {
      opened += 1;
    };

    await renderPopup(document.body, cloudOptions());
    await flush();

    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);
    expect(telltaleState()).toBe("off");
    expect(syncTitle()).toBe("Backup off");
    expect(syncDetail()).toBe("Turn on in settings.");
    expect(syncButton()).toBeNull();
    expect(unconfiguredNote()).toBeNull();

    turnOnLink()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(opened).toBe(1);
    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);

    delete (chrome.runtime as { openOptionsPage?: () => void }).openOptionsPage;
  });

  test("PU-CB-03 backup on with a fresh sync and nothing queued rests idle without syncing", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };

    await renderPopup(document.body, cloudOptions());
    await flush();

    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);
    expect(probeCalls).toBe(1);
    expect(autoGateLoadAdapterCalls).toBe(0);
    expect(telltaleState()).toBe("idle");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Synced just now.");
  });

  test("PU-CB-04 clicking 'Sync now' pushes and pulls, then reports the fresh sync", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };
    await renderPopup(document.body, cloudOptions());
    await flush();

    syncButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(calls.push).toBe(0); // nothing queued -> no push round-trip
    expect(calls.pull).toBe(1);
    expect(telltaleState()).toBe("idle");
    expect(syncDetail()).toBe("Synced just now.");
  });

  test("PU-CB-05 an unconfigured build shows plain 'Not configured' text and never syncs", async () => {
    configured = false;
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [outboxItem("a1")];

    await renderPopup(document.body, cloudOptions());
    await flush();

    expect(telltaleState()).toBe("unconfigured");
    expect(unconfiguredNote()?.textContent).toBe("Not configured");
    expect(syncButton()).toBeNull();
    expect(turnOnLink()).toBeNull();
    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);
  });

  test("PU-CB-06 a 'Sync now' failure surfaces the error telltale and retry copy", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };
    await renderPopup(document.body, cloudOptions());
    await flush();

    pullBlockedImpl = async () => {
      throw new Error("button boom");
    };
    syncButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(telltaleState()).toBe("error");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Sync failed. Tap retry.");
    // The one available action stays reachable for a retry — never a dead end.
    expect(syncButton()).not.toBeNull();
    expect(syncButton()!.disabled).toBe(false);
  });

  test("PU-CB-07 an auto-sync failure on open surfaces as the error state", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [outboxItem("a1")];
    pullBlockedImpl = async () => {
      throw new Error("open boom");
    };

    await renderPopup(document.body, cloudOptions());
    await flush();

    expect(telltaleState()).toBe("error");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Sync failed. Tap retry.");
  });

  test("PU-CB-08 a stale last sync auto-pulls even with nothing queued", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() - 16 * 60_000 };

    await renderPopup(document.body, cloudOptions());
    await flush();

    expect(calls.push).toBe(0); // nothing queued -> no push round-trip
    expect(calls.pull).toBe(1);
    expect(telltaleState()).toBe("idle");
  });

  test("PU-CB-09 the telltale dot carries a live 'syncing' state mid-flight, then resolves", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };
    await renderPopup(document.body, cloudOptions());
    await flush();

    let resolvePull: ((rows: RemoteAccount[]) => void) | undefined;
    pullBlockedImpl = () =>
      new Promise((resolve) => {
        resolvePull = resolve;
      });

    syncButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // setState("syncing") runs synchronously before the adapter's first await (module
    // loading is itself async), so the telltale + button already reflect the busy
    // state before any microtask has a chance to run.
    expect(telltaleState()).toBe("syncing");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Syncing…");
    expect(syncButton()!.disabled).toBe(true);
    expect(syncButton()!.textContent).toContain("Syncing…");

    // Let the chain (adapter load -> outbox read -> adapter.pull()) advance up to the
    // point where it's actually blocked on our deferred pull promise.
    await flush();
    resolvePull?.([]);
    await flush();

    expect(telltaleState()).toBe("idle");
    expect(syncButton()!.disabled).toBe(false);
    expect(syncButton()!.textContent).toContain("Sync now");
  });

  test("PU-CB-10 a manual sync that reports unconfigured mid-flight shows the unconfigured state", async () => {
    // Defensive path: runCloudSync re-checks the adapter's own isConfigured() at sync
    // time, independent of the mount-time gate that decides whether the "Sync now"
    // button exists at all — if the two ever disagree, the popup must still land on an
    // honest state rather than claiming success.
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };
    await renderPopup(document.body, cloudOptions());
    await flush();

    configured = false;
    syncButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(telltaleState()).toBe("unconfigured");
    expect(unconfiguredNote()?.textContent).toBe("Not configured");
    expect(syncButton()).toBeNull();
  });

  test("PU-CB-11 a manual sync started while the mount-time idle refresh is still in flight is not clobbered back to idle", async () => {
    // Fresh meta + nothing queued -> the mount IIFE's own auto-sync check decides
    // NOT to sync and takes its "idle" refresh branch (see main.ts's renderPopup).
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };

    let resolvePull: ((rows: RemoteAccount[]) => void) | undefined;
    pullBlockedImpl = () =>
      new Promise((resolve) => {
        resolvePull = resolve;
      });

    // No flush() here on purpose: renderPopup's own promise resolves once the row is
    // built (its mount-time auto-sync IIFE is fire-and-forget and still in flight,
    // suspended on its dynamic convex-sync import) — the "Sync now" button already
    // exists and is enabled at this point.
    await renderPopup(document.body, cloudOptions());

    syncButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // setState("syncing") runs synchronously in the click handler, same as PU-CB-09.
    expect(telltaleState()).toBe("syncing");

    // Let the mount IIFE run to completion: dynamic import -> isCloudConfigured ->
    // blockedStore.pending()/getSyncMeta() -> shouldAutoSync() false -> its idle
    // branch. The manual sync (blocked on our controlled pull) is still mid-flight.
    await flush();

    expect(telltaleState()).toBe("syncing");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Syncing…");
    expect(syncButton()!.disabled).toBe(true);

    resolvePull?.([]);
    await flush();

    expect(telltaleState()).toBe("idle");
    expect(syncButton()!.disabled).toBe(false);
  });

  test("PU-CB-12 the sync row's status copy is a polite, atomic live region", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: Date.now() };

    await renderPopup(document.body, cloudOptions());
    await flush();

    const copy = syncRow().querySelector<HTMLElement>(".xb-sync-copy");
    expect(copy?.getAttribute("aria-live")).toBe("polite");
    expect(copy?.getAttribute("aria-atomic")).toBe("true");
    // The telltale dot itself stays a purely decorative signal.
    expect(syncRow().querySelector(".xb-telltale")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("PU-CB-13 an auto-sync whose adapter goes unconfigured between the configured probe and the sync lands on unconfigured", async () => {
    // Auto-path twin of PU-CB-10: the mount-time probe sees a configured build (so the
    // session proceeds to the gate), but runCloudSync re-checks the adapter's own
    // isConfigured() and finds it gone. The row must land on the honest unconfigured
    // state, not silently claim an idle sync.
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [outboxItem("a1")]; // a pending action makes a sync due

    await renderPopup(document.body, {
      probeConfigured: async () => true,
      loadAdapter: async () => ({ ...adapter, isConfigured: () => false }),
    });
    await flush();

    expect(telltaleState()).toBe("unconfigured");
    expect(syncTitle()).toBe("Cloud backup");
    expect(syncDetail()).toBe("Not configured for this build.");
    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);
  });

  test("PU-CB-14 a genuinely-due open-time auto-sync shows the busy state mid-flight, then resolves idle", async () => {
    // Regression guard: with backup on and an action queued, the mount-time auto-sync
    // gate finds a sync due and — via the session's onSyncStart hook — flips the row to
    // "syncing" the instant the real run starts, disabling "Sync now". Without the hook
    // this window rendered the stale optimistic "idle" state with the button enabled.
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [outboxItem("a1")]; // pending -> a sync is due

    const deferredPull = Promise.withResolvers<RemoteAccount[]>();
    pullBlockedImpl = () => deferredPull.promise;

    await renderPopup(document.body, cloudOptions());
    // Let the IIFE run through the probe -> gate (due) -> onSyncStart ("syncing") ->
    // push, then block on our deferred pull.
    await flush();

    expect(telltaleState()).toBe("syncing");
    expect(syncTitle()).toBe("Backup on");
    expect(syncDetail()).toBe("Syncing…");
    expect(syncButton()!.disabled).toBe(true);
    expect(syncButton()!.textContent).toContain("Syncing…");

    deferredPull.resolve([]);
    await flush();

    expect(telltaleState()).toBe("idle");
    expect(syncDetail()).toBe("Synced just now.");
    expect(syncButton()!.disabled).toBe(false);
    expect(syncButton()!.textContent).toContain("Sync now");
  });
});
