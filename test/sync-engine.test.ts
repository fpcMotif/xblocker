// Catalog: SE-* (the shared one-shot cloud sync used by the popup and background) and
// AC-* (runAutoCloudSync, THE gate every automatic sync trigger flows through).
//
// The cloud transport is injected via the `loadAdapter` param (see docs/adr/0003), so
// these tests build plain CloudAdapter object fakes with call recording -- no bun
// mock.module. (The popup's own cloud-backup suite still uses mock.module; that is
// accepted debt tracked in the ADR, not something this file should imitate.)
import { beforeEach, describe, expect, test } from "bun:test";

import {
  getSyncMeta,
  runAutoCloudSync,
  runCloudSync,
  shouldAutoSync,
  SYNC_META_KEY,
  SYNC_STALE_MS,
  type CloudAdapter,
} from "../entrypoints/lib/sync-engine.ts";
import type { OutboxItem, RemoteAccount } from "../entrypoints/lib/blocked-store.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

const pendingItem = (actionId: string): OutboxItem => ({
  accountKey: "1",
  xUserId: "1",
  handle: "spammer",
  idUnknown: false,
  action: { actionId, kind: "block", at: 1, source: "reply-bar" },
});

/** Build a plain-object CloudAdapter fake with call recording, standing in for the
 *  `loadAdapter` param's resolved value. */
function makeAdapter(
  overrides: {
    configured?: boolean;
    push?: (items: OutboxItem[]) => Promise<string[]>;
    pull?: () => Promise<RemoteAccount[]>;
  } = {},
) {
  const calls = { isConfigured: 0, push: 0, pull: 0 };
  const configured = overrides.configured ?? true;
  const adapter: CloudAdapter = {
    isConfigured() {
      calls.isConfigured += 1;
      return configured;
    },
    async push(items) {
      calls.push += 1;
      return overrides.push ? overrides.push(items) : items.map((item) => item.action.actionId);
    },
    async pull() {
      calls.pull += 1;
      return overrides.pull ? overrides.pull() : [];
    },
  };
  return { adapter, calls };
}

beforeEach(() => {
  resetTestEnvironment();
});

describe("shouldAutoSync", () => {
  test("SE-01 never syncs when backup is off", () => {
    expect(shouldAutoSync(false, 5, {}, 1000)).toBe(false);
  });

  test("SE-02 syncs whenever actions are queued", () => {
    expect(shouldAutoSync(true, 1, { lastSyncAt: 1000 }, 1000)).toBe(true);
  });

  test("SE-03 with nothing queued, syncs only when the last pull is stale or absent", () => {
    expect(shouldAutoSync(true, 0, {}, 1000)).toBe(true); // never synced
    expect(shouldAutoSync(true, 0, { lastSyncAt: 1000 }, 1000 + SYNC_STALE_MS)).toBe(false);
    expect(shouldAutoSync(true, 0, { lastSyncAt: 1000 }, 1001 + SYNC_STALE_MS)).toBe(true);
  });
});

describe("getSyncMeta", () => {
  test("SE-04 returns the stored meta, or an empty object for missing/garbage values", async () => {
    expect(await getSyncMeta()).toEqual({});
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 42 };
    expect(await getSyncMeta()).toEqual({ lastSyncAt: 42 });
    storageFake.data[SYNC_META_KEY] = 7;
    expect(await getSyncMeta()).toEqual({});
  });
});

describe("runCloudSync", () => {
  test("SE-05 reports unconfigured without touching the store", async () => {
    const { adapter, calls } = makeAdapter({ configured: false });
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];

    expect(await runCloudSync(Date.now, () => Promise.resolve(adapter))).toEqual({
      status: "unconfigured",
    });
    expect(calls).toEqual({ isConfigured: 1, push: 0, pull: 0 });
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    expect(storageFake.data[SYNC_META_KEY]).toBeUndefined();
  });

  test("SE-06 pushes the outbox, pulls + merges remote rows, and stamps lastSyncAt", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter({
      pull: async () => [
        {
          xUserId: "2",
          handle: "other",
          idUnknown: false,
          firstActionAt: 1,
          lastActionAt: 1,
          blockCount: 1,
          muteCount: 0,
          status: "active",
        },
      ],
    });

    const outcome = await runCloudSync(
      () => 12345,
      () => Promise.resolve(adapter),
    );

    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 1, at: 12345 });
    expect(calls).toEqual({ isConfigured: 1, push: 1, pull: 1 });
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({ lastSyncAt: 12345 });
    expect(storageFake.data["blockedAccounts"]).toMatchObject({ "2": { handle: "other" } });
  });

  test("SE-07 skips the push round-trip entirely when nothing is queued", async () => {
    const { adapter, calls } = makeAdapter();
    const outcome = await runCloudSync(
      () => 99,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "synced", pushed: 0, pulled: 0, at: 99 });
    expect(calls).toEqual({ isConfigured: 1, push: 0, pull: 1 });
  });

  test("SE-08 the default loadAdapter param falls back to the real convex-sync module and short-circuits when unconfigured (no network)", async () => {
    // No explicit loadAdapter -> exercises the default `loadConvexAdapter`, a real
    // `import("./convex-sync")`. Force the deployment URL unset so the real adapter's
    // isConfigured() is false and the call returns before any network I/O.
    const originalUrl = process.env["VITE_CONVEX_URL"];
    delete process.env["VITE_CONVEX_URL"];
    try {
      expect(await runCloudSync()).toEqual({ status: "unconfigured" });
    } finally {
      if (originalUrl !== undefined) process.env["VITE_CONVEX_URL"] = originalUrl;
    }
  });
});

describe("runAutoCloudSync", () => {
  test("AC-01 skipped when enabled but nothing is pending and the last sync is fresh -- the adapter is never loaded", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    const { adapter } = makeAdapter();
    let loaderCalls = 0;
    const loadAdapter = () => {
      loaderCalls += 1;
      return Promise.resolve(adapter);
    };

    const outcome = await runAutoCloudSync(true, () => 1000, loadAdapter);
    expect(outcome).toEqual({ status: "skipped" });
    expect(loaderCalls).toBe(0);
  });

  test("AC-02 proceeds (delegates to a full sync) when actions are pending", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter();

    const outcome = await runAutoCloudSync(
      true,
      () => 1000,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 0, at: 1000 });
    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
  });

  test("AC-03 proceeds when the last sync is stale, even with nothing pending", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    const { adapter, calls } = makeAdapter();
    const staleNow = 1000 + SYNC_STALE_MS + 1;

    const outcome = await runAutoCloudSync(
      true,
      () => staleNow,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "synced", pushed: 0, pulled: 0, at: staleNow });
    expect(calls.pull).toBe(1);
  });

  test("AC-04 skipped when disabled, regardless of pending or staleness -- the adapter is never loaded", async () => {
    // Nothing stored for SYNC_META_KEY -> "never synced" would otherwise be due, and
    // there is a pending action too; disabled must still win over both.
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter } = makeAdapter();
    let loaderCalls = 0;
    const loadAdapter = () => {
      loaderCalls += 1;
      return Promise.resolve(adapter);
    };

    const outcome = await runAutoCloudSync(false, () => 1000, loadAdapter);
    expect(outcome).toEqual({ status: "skipped" });
    expect(loaderCalls).toBe(0);
  });

  test("AC-05 an unconfigured adapter still yields {status: unconfigured} when a sync is due", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter } = makeAdapter({ configured: false });

    const outcome = await runAutoCloudSync(
      true,
      () => 1000,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "unconfigured" });
  });
});
