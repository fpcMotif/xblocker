// Catalog: SE-* (the shared one-shot cloud sync used by the popup and background),
// AC-* (runAutoCloudSync, THE gate every automatic sync trigger flows through), RCS-*
// (readCloudDisplayState, the one storage read the settings pane renders its rows from),
// and OC-01 (the shared formatSyncAge age-line formatter, which lives here now
// that sync-engine owns SyncMeta). GEN-* covers the generic collection port and the
// all-collections drivers (runCloudSyncAll / runAutoCloudSyncAll) added in ADR-0005.
//
// The cloud transport is injected via the `loadAdapter` param (see docs/adr/0003), so
// every cloud suite -- this one, the popup sync-row suite, and the options cloud pane
// suite -- builds plain CloudAdapter object fakes with call recording. No bun
// module-path mocking anywhere (the ADR-0003 popup-seam debt was retired 2026-07-15).
import { beforeEach, describe, expect, test } from "bun:test";

import {
  blockedCollection,
  formatSyncAge,
  getSyncMeta,
  readCloudDisplayState,
  readCombinedSyncMeta,
  runAutoCloudSync,
  runAutoCloudSyncAll,
  runCloudSync,
  runCloudSyncAll,
  shouldAutoSync,
  SYNC_META_KEY,
  SYNC_STALE_MS,
  SYNCED_COLLECTIONS,
  whitelistCollection,
  WHITELIST_SYNC_META_KEY,
  type CloudAdapter,
  type SyncedCollection,
} from "../sync-engine.ts";
import type { OutboxItem, RemoteAccount } from "../../storage/blocked-store.ts";
import type { RemoteWhitelistEntry, WhitelistOutboxItem } from "../../storage/whitelist-store.ts";
import { CLOUD_BACKUP_KEY } from "../../storage/chrome-storage.ts";
import { resetTestEnvironment, storageFake } from "../../../test/setup.ts";

const pendingItem = (actionId: string): OutboxItem => ({
  accountKey: "1",
  xUserId: "1",
  handle: "spammer",
  idUnknown: false,
  action: { actionId, kind: "block", at: 1, source: "reply-bar" },
});

const whitelistItem = (handle: string, actionId: string): WhitelistOutboxItem => ({
  handle,
  status: "active",
  at: 1,
  actionId,
});

/** Accept every pushed item, whatever the collection's item shape. */
const acceptAll = (items: Array<OutboxItem | WhitelistOutboxItem>) =>
  Promise.resolve(items.map((item) => ("action" in item ? item.action.actionId : item.actionId)));

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
    // The engine paths under test (runCloudSync / runAutoCloudSync / readCloudDisplayState)
    // never wipe, so clear is a satisfy-the-port no-op with nothing to record.
    async clear() {},
  };
  return { adapter, calls };
}

/** A fake adapter loose enough to serve any collection in the All drivers. */
function makeAnyAdapter(overrides: { configured?: boolean } = {}) {
  const calls = { isConfigured: 0, push: 0, pull: 0 };
  const adapter: CloudAdapter<
    OutboxItem | WhitelistOutboxItem,
    RemoteAccount | RemoteWhitelistEntry
  > = {
    isConfigured() {
      calls.isConfigured += 1;
      return overrides.configured ?? true;
    },
    async push(items) {
      calls.push += 1;
      return acceptAll(items);
    },
    async pull() {
      calls.pull += 1;
      return [];
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

  test("SE-04b reads a collection's own meta key", async () => {
    storageFake.data[WHITELIST_SYNC_META_KEY] = { lastSyncAt: 77 };
    expect(await getSyncMeta(WHITELIST_SYNC_META_KEY)).toEqual({ lastSyncAt: 77 });
    expect(await getSyncMeta()).toEqual({}); // the blocklist key stays untouched
  });
});

describe("runCloudSync", () => {
  test("SE-05 reports unconfigured without touching the store", async () => {
    const { adapter, calls } = makeAdapter({ configured: false });
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];

    expect(await runCloudSync(blockedCollection, Date.now, () => Promise.resolve(adapter))).toEqual(
      {
        status: "unconfigured",
      },
    );
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
      blockedCollection,
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
      blockedCollection,
      () => 99,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "synced", pushed: 0, pulled: 0, at: 99 });
    expect(calls).toEqual({ isConfigured: 1, push: 0, pull: 1 });
  });

  test("SE-08 the default loadAdapter param falls back to the real convex-sync module and short-circuits when unconfigured (no network)", async () => {
    // No explicit loadAdapter -> exercises the collection's own loader, a real
    // `import("./lib/convex-sync")`. Force the deployment URL unset so the real adapter's
    // isConfigured() is false and the call returns before any network I/O.
    const originalUrl = process.env["VITE_CONVEX_URL"];
    delete process.env["VITE_CONVEX_URL"];
    try {
      expect(await runCloudSync(blockedCollection)).toEqual({ status: "unconfigured" });
      expect(await runCloudSync(whitelistCollection)).toEqual({ status: "unconfigured" });
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

    const outcome = await runAutoCloudSync(blockedCollection, true, () => 1000, loadAdapter);
    expect(outcome).toEqual({ status: "skipped" });
    expect(loaderCalls).toBe(0);
  });

  test("AC-02 proceeds (delegates to a full sync) when actions are pending", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter();

    const outcome = await runAutoCloudSync(
      blockedCollection,
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
      blockedCollection,
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

    const outcome = await runAutoCloudSync(blockedCollection, false, () => 1000, loadAdapter);
    expect(outcome).toEqual({ status: "skipped" });
    expect(loaderCalls).toBe(0);
  });

  test("AC-05 an unconfigured adapter still yields {status: unconfigured} when a sync is due", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter } = makeAdapter({ configured: false });

    const outcome = await runAutoCloudSync(
      blockedCollection,
      true,
      () => 1000,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "unconfigured" });
  });

  test("AC-06 onWillSync fires exactly once when a sync is due, right before the run", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")]; // pending -> a sync is due
    const { adapter } = makeAdapter();
    let willSync = 0;

    const outcome = await runAutoCloudSync(
      blockedCollection,
      true,
      () => 1000,
      () => Promise.resolve(adapter),
      () => {
        willSync += 1;
      },
    );
    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 0, at: 1000 });
    expect(willSync).toBe(1);
  });

  test("AC-07 onWillSync is NOT called on the skipped path (fresh meta, nothing pending)", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 }; // fresh + nothing queued -> not due
    const { adapter } = makeAdapter();
    let willSync = 0;

    const outcome = await runAutoCloudSync(
      blockedCollection,
      true,
      () => 1000,
      () => Promise.resolve(adapter),
      () => {
        willSync += 1;
      },
    );
    expect(outcome).toEqual({ status: "skipped" });
    expect(willSync).toBe(0);
  });

  test("AC-08 onWillSync is NOT called when disabled, even with a pending action", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")]; // would be due, but disabled wins
    const { adapter } = makeAdapter();
    let willSync = 0;

    const outcome = await runAutoCloudSync(
      blockedCollection,
      false,
      () => 1000,
      () => Promise.resolve(adapter),
      () => {
        willSync += 1;
      },
    );
    expect(outcome).toEqual({ status: "skipped" });
    expect(willSync).toBe(0);
  });
});

describe("generic collection port", () => {
  type FakeItem = { actionId: string; at: number };
  type FakeRemote = { key: string; at: number };

  /** A second (whitelist-shaped) fake collection, proving the engine drives ANY store
   *  through the port without knowing its item/remote shape. */
  function makeFakeCollection(metaKey: string) {
    const calls = {
      pending: 0,
      markSynced: [] as string[][],
      mergeRemote: [] as FakeRemote[][],
      backfill: 0,
    };
    const pendingItems: FakeItem[] = [];
    const collection: SyncedCollection<FakeItem, FakeRemote> = {
      name: "fake",
      metaKey,
      store: {
        async pending() {
          calls.pending += 1;
          return pendingItems;
        },
        async markSynced(actionIds) {
          calls.markSynced.push(actionIds);
          const done = new Set(actionIds);
          for (let i = pendingItems.length - 1; i >= 0; i -= 1) {
            if (done.has(pendingItems[i]!.actionId)) pendingItems.splice(i, 1);
          }
        },
        async mergeRemote(remote) {
          calls.mergeRemote.push(remote);
        },
        async backfill() {
          calls.backfill += 1;
        },
      },
      loadAdapter: async () => {
        throw new Error("tests must inject the adapter");
      },
    };
    return { collection, calls, pendingItems };
  }

  function makeFakeAdapter(remote: FakeRemote[] = []) {
    const calls = { push: [] as FakeItem[][], pull: 0 };
    const adapter: CloudAdapter<FakeItem, FakeRemote> = {
      isConfigured: () => true,
      async push(items) {
        // Snapshot: the store's pending() may hand over its live array, which
        // markSynced then drains — recording the reference would see the drain.
        calls.push.push([...items]);
        return items.map((item) => item.actionId);
      },
      async pull() {
        calls.pull += 1;
        return remote;
      },
    };
    return { adapter, calls };
  }

  test("GEN-01 the engine drives a second collection shape through the same port", async () => {
    const { collection, calls, pendingItems } = makeFakeCollection("fakeMeta");
    pendingItems.push({ actionId: "w1", at: 5 });
    const remote: FakeRemote[] = [{ key: "r1", at: 9 }];
    const { adapter, calls: adapterCalls } = makeFakeAdapter(remote);

    const outcome = await runCloudSync(
      collection,
      () => 4242,
      () => Promise.resolve(adapter),
    );

    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 1, at: 4242 });
    expect(adapterCalls.push).toEqual([[{ actionId: "w1", at: 5 }]]);
    expect(calls.markSynced).toEqual([["w1"]]);
    expect(calls.mergeRemote).toEqual([remote]);
    expect(pendingItems).toEqual([]);
    // Meta is stamped under the collection's OWN key, never a shared one.
    expect(storageFake.data["fakeMeta"]).toEqual({ lastSyncAt: 4242 });
    expect(storageFake.data[SYNC_META_KEY]).toBeUndefined();
  });

  test("GEN-02 the first-ever sync runs the store's backfill hook before pushing", async () => {
    const { collection, calls } = makeFakeCollection("fakeMeta");
    const { adapter } = makeFakeAdapter();

    await runCloudSync(collection, Date.now, () => Promise.resolve(adapter));
    expect(calls.backfill).toBe(1);

    // A later sync (meta now stamped) does not backfill again.
    await runCloudSync(collection, Date.now, () => Promise.resolve(adapter));
    expect(calls.backfill).toBe(1);
  });

  test("GEN-03 backfill never runs when the adapter is unconfigured", async () => {
    const { collection, calls } = makeFakeCollection("fakeMeta");
    const adapter: CloudAdapter<FakeItem, FakeRemote> = {
      isConfigured: () => false,
      async push() {
        return [];
      },
      async pull() {
        return [];
      },
    };

    expect(await runCloudSync(collection, Date.now, () => Promise.resolve(adapter))).toEqual({
      status: "unconfigured",
    });
    expect(calls.backfill).toBe(0);
    expect(calls.pending).toBe(0);
  });

  test("GEN-04 the per-collection auto gate shares the one shouldAutoSync policy", async () => {
    const { collection, pendingItems } = makeFakeCollection("fakeMeta");
    storageFake.data["fakeMeta"] = { lastSyncAt: 1000 };

    // Fresh meta + nothing pending -> skipped, exactly like the blocklist cases.
    expect(await runAutoCloudSync(collection, true, () => 1000, collection.loadAdapter)).toEqual({
      status: "skipped",
    });

    // A pending change flips the same policy to due.
    pendingItems.push({ actionId: "w1", at: 5 });
    const { adapter } = makeFakeAdapter();
    const outcome = await runAutoCloudSync(
      collection,
      true,
      () => 1000,
      () => Promise.resolve(adapter),
    );
    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 0, at: 1000 });
  });
});

describe("runCloudSyncAll", () => {
  test("GEN-10 syncs every collection, sums the counts, and stamps each meta key", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    storageFake.data["whitelistOutbox"] = [
      whitelistItem("alice", "w1"),
      whitelistItem("bob", "w2"),
    ];
    const { adapter, calls } = makeAnyAdapter();

    const outcome = await runCloudSyncAll(
      () => 500,
      async () => adapter,
    );

    expect(outcome).toEqual({ status: "synced", pushed: 3, pulled: 0, at: 500 });
    expect(calls.push).toBe(2); // one push round per collection
    expect(calls.pull).toBe(2);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data["whitelistOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({ lastSyncAt: 500 });
    expect(storageFake.data[WHITELIST_SYNC_META_KEY]).toEqual({ lastSyncAt: 500 });
  });

  test("GEN-11 stops at the first unconfigured collection (one deployment, one config)", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAnyAdapter({ configured: false });

    expect(
      await runCloudSyncAll(
        () => 500,
        async () => adapter,
      ),
    ).toEqual({
      status: "unconfigured",
    });
    expect(calls.push).toBe(0);
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    expect(storageFake.data[SYNC_META_KEY]).toBeUndefined();
    expect(storageFake.data[WHITELIST_SYNC_META_KEY]).toBeUndefined();
  });

  test("GEN-12 covers both real collections in order: blocklist first, whitelist second", () => {
    expect(SYNCED_COLLECTIONS.map((collection) => collection.name)).toEqual([
      "blocked",
      "whitelist",
    ]);
  });
});

describe("runAutoCloudSyncAll", () => {
  test("GEN-13 skipped only when NO collection is due; the adapter never loads", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    storageFake.data[WHITELIST_SYNC_META_KEY] = { lastSyncAt: 1000 };
    let loaderCalls = 0;

    const outcome = await runAutoCloudSyncAll(
      true,
      () => 1000,
      async () => {
        loaderCalls += 1;
        return makeAnyAdapter().adapter;
      },
    );

    expect(outcome).toEqual({ status: "skipped" });
    expect(loaderCalls).toBe(0);
  });

  test("GEN-14 a dirty whitelist with a clean blocklist still triggers a sync of both", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 }; // blocklist fresh
    storageFake.data[WHITELIST_SYNC_META_KEY] = { lastSyncAt: 1000 };
    storageFake.data["whitelistOutbox"] = [whitelistItem("alice", "w1")];
    const { adapter, calls } = makeAnyAdapter();
    let willSync = 0;

    const outcome = await runAutoCloudSyncAll(
      true,
      () => 1000,
      async () => adapter,
      () => {
        willSync += 1;
      },
    );

    expect(outcome).toEqual({ status: "synced", pushed: 1, pulled: 0, at: 1000 });
    expect(storageFake.data["whitelistOutbox"]).toEqual([]);
    // onWillSync fires once for the whole run, not once per collection.
    expect(willSync).toBe(1);
    expect(calls.pull).toBe(2);
  });

  test("GEN-15 disabled backup skips even when a collection is dirty", async () => {
    storageFake.data["whitelistOutbox"] = [whitelistItem("alice", "w1")];
    let loaderCalls = 0;

    const outcome = await runAutoCloudSyncAll(
      false,
      () => 1000,
      async () => {
        loaderCalls += 1;
        return makeAnyAdapter().adapter;
      },
    );

    expect(outcome).toEqual({ status: "skipped" });
    expect(loaderCalls).toBe(0);
    expect(storageFake.data["whitelistOutbox"]).toHaveLength(1);
  });
});

describe("readCombinedSyncMeta", () => {
  test("GEN-16 reports the oldest collection stamp, or empty when none exist", async () => {
    expect(await readCombinedSyncMeta()).toEqual({});
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 900 };
    expect(await readCombinedSyncMeta()).toEqual({ lastSyncAt: 900 });
    storageFake.data[WHITELIST_SYNC_META_KEY] = { lastSyncAt: 100 };
    expect(await readCombinedSyncMeta()).toEqual({ lastSyncAt: 100 });
  });
});

describe("readCloudDisplayState", () => {
  test("RCS-01 reports enabled + meta + pending from storage without touching an adapter", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 42 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1"), pendingItem("a2")];

    expect(await readCloudDisplayState()).toEqual({
      enabled: true,
      meta: { lastSyncAt: 42 },
      pendingCount: 2,
    });
  });

  test("RCS-02 reports disabled defaults against an empty store", async () => {
    expect(await readCloudDisplayState()).toEqual({
      enabled: false,
      meta: {},
      pendingCount: 0,
    });
  });

  test("RCS-03 treats any non-true cloudBackup value as disabled", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = "yes"; // truthy but not === true
    expect((await readCloudDisplayState()).enabled).toBe(false);
  });

  test("RCS-04 reports the whitelist collection's own meta and pending depth", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    storageFake.data[WHITELIST_SYNC_META_KEY] = { lastSyncAt: 7 };
    storageFake.data["whitelistOutbox"] = [whitelistItem("alice", "w1")];
    storageFake.data["blockedOutbox"] = [pendingItem("a1"), pendingItem("a2")];

    expect(await readCloudDisplayState(whitelistCollection)).toEqual({
      enabled: true,
      meta: { lastSyncAt: 7 },
      pendingCount: 1,
    });
    // The blocklist's own read is unaffected by whitelist state.
    expect(await readCloudDisplayState(blockedCollection)).toEqual({
      enabled: true,
      meta: {},
      pendingCount: 2,
    });
  });
});

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
