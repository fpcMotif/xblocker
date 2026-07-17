// Catalog: CS-* (shared cloud-sync UI orchestration).
import { beforeEach, describe, expect, test } from "bun:test";

import type { OutboxItem, RemoteAccount } from "../entrypoints/lib/blocked-store.ts";
import {
  createCloudSyncSession,
  formatSyncAge,
  mapSyncOutcomeToState,
} from "../entrypoints/lib/cloud-session.ts";
import { SYNC_META_KEY, SYNC_STALE_MS, type CloudAdapter } from "../entrypoints/lib/sync-engine.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

function pendingItem(actionId: string): OutboxItem {
  return {
    accountKey: "1",
    xUserId: "1",
    handle: "spammer",
    idUnknown: false,
    action: { actionId, kind: "block", at: 1, source: "reply-bar" },
  };
}

function makeAdapter(
  overrides: {
    configured?: boolean;
    push?: (items: OutboxItem[]) => Promise<string[]>;
    pull?: () => Promise<RemoteAccount[]>;
  } = {},
) {
  const calls = { isConfigured: 0, push: 0, pull: 0 };
  const adapter: CloudAdapter = {
    isConfigured() {
      calls.isConfigured += 1;
      return overrides.configured ?? true;
    },
    async push(items) {
      calls.push += 1;
      return overrides.push?.(items) ?? items.map((item) => item.action.actionId);
    },
    async pull() {
      calls.pull += 1;
      return overrides.pull?.() ?? [];
    },
  };
  return { adapter, calls };
}

function forbiddenLoader(): Promise<CloudAdapter> {
  throw new Error("loadAdapter must not run");
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not settle");
}

async function flushStorageMicrotasks(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    storageFake.flush();
    await Promise.resolve();
  }
}

beforeEach(() => {
  resetTestEnvironment();
});

describe("formatSyncAge", () => {
  test("CS-01 formats the shared coarse age strings", () => {
    const now = 10 * 24 * 60 * 60_000;
    expect(formatSyncAge({}, now)).toBe("Never synced.");
    expect(formatSyncAge({ lastSyncAt: now - 10_000 }, now)).toBe("Synced just now.");
    expect(formatSyncAge({ lastSyncAt: now - 5 * 60_000 }, now)).toBe("Synced 5m ago.");
    expect(formatSyncAge({ lastSyncAt: now - 3 * 60 * 60_000 }, now)).toBe("Synced 3h ago.");
    expect(formatSyncAge({ lastSyncAt: now - 2 * 24 * 60 * 60_000 }, now)).toBe("Synced 2d ago.");
    expect(formatSyncAge({ lastSyncAt: now + 60_000 }, now)).toBe("Synced just now.");
  });
});

describe("mapSyncOutcomeToState", () => {
  test("CS-02 maps unconfigured, synced, and skipped outcomes", () => {
    expect(mapSyncOutcomeToState({ status: "unconfigured" }, {}, 0)).toEqual({
      state: "unconfigured",
      detail: "",
    });
    expect(
      mapSyncOutcomeToState({ status: "synced", pushed: 1, pulled: 0, at: 1000 }, {}, 1000),
    ).toEqual({ state: "idle", detail: "Synced just now." });
    expect(mapSyncOutcomeToState({ status: "skipped" }, { lastSyncAt: 0 }, 5 * 60_000)).toEqual({
      state: "idle",
      detail: "Synced 5m ago.",
    });
  });
});

describe("runManual", () => {
  test("CS-03 runs unconditionally, drains the outbox, and stamps sync meta", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter();
    const session = createCloudSyncSession({
      loadAdapter: async () => adapter,
      now: () => 12345,
    });

    expect(await session.runManual()).toEqual({
      outcome: { status: "synced", pushed: 1, pulled: 0, at: 12345 },
      state: "idle",
      detail: "Synced just now.",
    });
    expect(calls).toEqual({ isConfigured: 1, push: 1, pull: 1 });
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({ lastSyncAt: 12345 });
  });

  test("CS-04 reports an unconfigured adapter without touching meta", async () => {
    const { adapter, calls } = makeAdapter({ configured: false });
    const session = createCloudSyncSession({ loadAdapter: async () => adapter });

    expect(await session.runManual()).toEqual({
      outcome: { status: "unconfigured" },
      state: "unconfigured",
      detail: "",
    });
    expect(calls).toEqual({ isConfigured: 1, push: 0, pull: 0 });
    expect(storageFake.data[SYNC_META_KEY]).toBeUndefined();
  });

  test("CS-05 errors propagate and release the guard", async () => {
    const { adapter } = makeAdapter({
      pull: async () => {
        throw new Error("pull boom");
      },
    });
    const session = createCloudSyncSession({ loadAdapter: async () => adapter });

    const run = session.runManual();
    expect(run).rejects.toThrow("pull boom");
    await run.catch(() => undefined);
    expect(session.isInFlight()).toBe(false);
  });

  test("CS-06 ignores a second manual sync while the first is pending", async () => {
    let resolvePull: ((rows: RemoteAccount[]) => void) | undefined;
    const { adapter, calls } = makeAdapter({
      pull: () =>
        new Promise((resolve) => {
          resolvePull = resolve;
        }),
    });
    const session = createCloudSyncSession({
      loadAdapter: async () => adapter,
      now: () => 7,
    });

    const first = session.runManual();
    expect(session.isInFlight()).toBe(true);
    expect(await session.runManual()).toBeNull();

    await waitUntil(() => resolvePull !== undefined);
    resolvePull?.([]);
    expect((await first)?.outcome).toEqual({
      status: "synced",
      pushed: 0,
      pulled: 0,
      at: 7,
    });
    expect(session.isInFlight()).toBe(false);
    expect(calls.pull).toBe(1);
  });
});

describe("runAutoOnOpen", () => {
  test("CS-07 fresh meta and no pending work skip before loading the adapter", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    const session = createCloudSyncSession({
      loadAdapter: forbiddenLoader,
      now: () => 1000,
    });

    expect(await session.runAutoOnOpen(true)).toEqual({
      outcome: { status: "skipped" },
      state: "idle",
      detail: "Synced just now.",
    });
  });

  test("CS-08 the configured probe stays separate from the auto gate", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    let probeCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: forbiddenLoader,
      probeConfigured: async () => {
        probeCalls += 1;
        return true;
      },
      now: () => 1000,
    });

    expect(await session.isBuildConfigured()).toBe(true);
    expect((await session.runAutoOnOpen(true)).outcome).toEqual({ status: "skipped" });
    expect(probeCalls).toBe(1);
  });

  test("CS-09 pending work proceeds through the gate", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter();
    let loadCalls = 0;
    let startCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: async () => {
        loadCalls += 1;
        return adapter;
      },
      now: () => 1000,
    });

    expect(
      await session.runAutoOnOpen(true, {
        onSyncStart: () => {
          startCalls += 1;
        },
      }),
    ).toEqual({
      outcome: { status: "synced", pushed: 1, pulled: 0, at: 1000 },
      state: "idle",
      detail: "Synced just now.",
    });
    expect(loadCalls).toBe(1);
    expect(startCalls).toBe(1);
    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
  });

  test("CS-10 stale meta proceeds without a push", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    const { adapter, calls } = makeAdapter();
    const staleNow = 1000 + SYNC_STALE_MS + 1;
    const session = createCloudSyncSession({
      loadAdapter: async () => adapter,
      now: () => staleNow,
    });

    const result = await session.runAutoOnOpen(true);

    expect(result.outcome).toEqual({
      status: "synced",
      pushed: 0,
      pulled: 0,
      at: staleNow,
    });
    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(1);
  });

  test("CS-11 disabled backup skips without loading the adapter", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const session = createCloudSyncSession({
      loadAdapter: forbiddenLoader,
      now: () => 1000,
    });

    expect(await session.runAutoOnOpen(false)).toEqual({
      outcome: { status: "skipped" },
      state: "idle",
      detail: "Never synced.",
    });
  });

  test("CS-12 failures map to error and release the guard", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter } = makeAdapter({
      pull: async () => {
        throw new Error("open boom");
      },
    });
    const session = createCloudSyncSession({ loadAdapter: async () => adapter });

    expect(await session.runAutoOnOpen(true)).toEqual({ state: "error", detail: "" });
    expect(session.isInFlight()).toBe(false);
  });

  test("CS-13 a manual sync already in flight blocks the auto pass", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    let resolvePull: ((rows: RemoteAccount[]) => void) | undefined;
    const { adapter, calls } = makeAdapter({
      pull: () =>
        new Promise((resolve) => {
          resolvePull = resolve;
        }),
    });
    let loadCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: async () => {
        loadCalls += 1;
        return adapter;
      },
      now: () => 7,
    });

    const manual = session.runManual();

    expect(await session.runAutoOnOpen(true)).toEqual({
      state: "syncing",
      detail: "",
    });
    expect(loadCalls).toBe(1);

    await waitUntil(() => resolvePull !== undefined);
    resolvePull?.([]);
    await manual;
    expect(calls.pull).toBe(1);
  });

  test("CS-14 a manual sync started during auto preflight supersedes the auto pass", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    storageFake.useManualDispatch();
    let resolveManualPull: ((rows: RemoteAccount[]) => void) | undefined;
    let pullAttempts = 0;
    const { adapter, calls } = makeAdapter({
      pull: () => {
        pullAttempts += 1;
        if (pullAttempts > 1) return Promise.resolve([]);
        return new Promise((resolve) => {
          resolveManualPull = resolve;
        });
      },
    });
    let loadCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: async () => {
        loadCalls += 1;
        return adapter;
      },
    });

    const auto = session.runAutoOnOpen(true);
    const manual = session.runManual();
    await flushStorageMicrotasks();
    const loadCallsBeforeRelease = loadCalls;
    resolveManualPull?.([]);

    await flushStorageMicrotasks();
    const [autoResult] = await Promise.all([auto, manual]);

    expect(autoResult).toEqual({ state: "syncing", detail: "" });
    expect(loadCallsBeforeRelease).toBe(1);
    expect(calls.pull).toBe(1);
    expect(session.isInFlight()).toBe(false);
  });
});

describe("wipeCloud", () => {
  test("CS-15 clears cloud, drains outbox, clears meta, and turns backup off", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 12345 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1"), pendingItem("a2")];
    storageFake.data["blockedAccounts"] = {
      "1": { key: "1", handle: "spammer", status: "active" },
    };
    let clearCalls = 0;
    const session = createCloudSyncSession({
      clearCloud: async () => {
        clearCalls += 1;
      },
    });

    expect(await session.wipeCloud()).toEqual({ pendingCount: 0 });
    expect(clearCalls).toBe(1);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({});
    expect(storageFake.data["cloudBackup"]).toBe(false);
    expect(storageFake.data["blockedAccounts"]).toMatchObject({
      "1": { handle: "spammer" },
    });
  });

  test("CS-16 a clear failure stops before local side effects", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const session = createCloudSyncSession({
      clearCloud: async () => {
        throw new Error("wipe boom");
      },
    });

    const wipe = session.wipeCloud();
    expect(wipe).rejects.toThrow("wipe boom");
    await wipe.catch(() => undefined);
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    expect(storageFake.data["cloudBackup"]).toBe(true);
  });
});

describe("production defaults", () => {
  test("CS-17 lazy Convex ports short-circuit when unconfigured", async () => {
    const originalUrl = process.env["VITE_CONVEX_URL"];
    delete process.env["VITE_CONVEX_URL"];
    try {
      const session = createCloudSyncSession();
      expect(await session.isBuildConfigured()).toBe(false);
      expect(await session.runManual()).toEqual({
        outcome: { status: "unconfigured" },
        state: "unconfigured",
        detail: "",
      });

      storageFake.data["blockedOutbox"] = [pendingItem("a1")];
      const wipe = session.wipeCloud();
      expect(wipe).rejects.toThrow(/not configured/);
      await wipe.catch(() => undefined);
      expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    } finally {
      if (originalUrl !== undefined) process.env["VITE_CONVEX_URL"] = originalUrl;
    }
  });
});
