// Catalog: SE-* (the shared one-shot cloud sync used by the popup and background).
//
// convex-sync is the live-Convex adapter, so it is mocked at the module boundary here,
// exactly like the popup cloud-backup suite does.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type OutboxLike = { action: { actionId: string } };

let configured: boolean;
let pushOutboxImpl: (items: OutboxLike[]) => Promise<string[]>;
let pullBlockedImpl: () => Promise<unknown[]>;
let calls: { push: number; pull: number };

await mock.module("../entrypoints/lib/convex-sync", () => ({
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

const { getSyncMeta, runCloudSync, shouldAutoSync, SYNC_META_KEY, SYNC_STALE_MS } =
  await import("../entrypoints/lib/sync-engine.ts");
const { resetTestEnvironment, storageFake } = await import("./setup.ts");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  resetTestEnvironment();
  configured = true;
  pushOutboxImpl = async (items) => items.map((item) => item.action.actionId);
  pullBlockedImpl = async () => [];
  calls = { push: 0, pull: 0 };
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
    configured = false;
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        xUserId: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];

    expect(await runCloudSync()).toEqual({ status: "unconfigured" });
    expect(calls).toEqual({ push: 0, pull: 0 });
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    expect(storageFake.data[SYNC_META_KEY]).toBeUndefined();
  });

  test("SE-06 pushes the outbox, pulls + merges remote rows, and stamps lastSyncAt", async () => {
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        xUserId: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];
    pullBlockedImpl = async () => [
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
    ];

    const outcome = await runCloudSync(() => 12345);

    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 1, at: 12345 });
    expect(calls).toEqual({ push: 1, pull: 1 });
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({ lastSyncAt: 12345 });
    expect(storageFake.data["blockedAccounts"]).toMatchObject({ "2": { handle: "other" } });
  });

  test("SE-07 skips the push round-trip entirely when nothing is queued", async () => {
    const outcome = await runCloudSync(() => 99);
    expect(outcome).toEqual({ status: "synced", pushed: 0, pulled: 0, at: 99 });
    expect(calls).toEqual({ push: 0, pull: 1 });
  });
});
