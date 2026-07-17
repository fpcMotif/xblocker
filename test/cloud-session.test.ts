// Catalog: CS-* (cloud-session, the shared popup/options sync orchestration: format,
// outcome->state mapping, guarded manual sync, auto-on-open through THE runAutoCloudSync
// gate, the separate configured probe, and the wipe sequence).
//
// Transports are injected as plain ports (loadAdapter / probeConfigured / clearCloud) —
// no process-global module-path mocking anywhere (see docs/adr/0003's
// implementation-status note and the Candidate B handoff in docs/architecture/handoffs/).
import { beforeEach, describe, expect, test } from "bun:test";

import type { OutboxItem, RemoteAccount } from "../entrypoints/lib/blocked-store.ts";
import {
  createCloudSyncSession,
  formatSyncAge,
  mapSyncOutcomeToState,
} from "../entrypoints/lib/cloud-session.ts";
import { SYNC_META_KEY, SYNC_STALE_MS, type CloudAdapter } from "../entrypoints/lib/sync-engine.ts";
import { settleMicrotasks } from "./helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

const pendingItem = (actionId: string): OutboxItem => ({
  accountKey: "1",
  xUserId: "1",
  handle: "spammer",
  idUnknown: false,
  action: { actionId, kind: "block", at: 1, source: "reply-bar" },
});

/** Build a plain-object CloudAdapter fake with call recording, standing in for the
 *  loadAdapter port's resolved value (same pattern as test/sync-engine.test.ts). */
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

/** The AC-01-style skip falsifier: a loader the quiet path must never reach. */
function forbiddenLoader(): Promise<CloudAdapter> {
  throw new Error("loadAdapter must not be called on the skip path");
}

/** Await a promise that must reject; hands back the thrown value for assertions. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

beforeEach(() => {
  resetTestEnvironment();
});

describe("formatSyncAge", () => {
  test("CS-01 formats never/just-now/minutes/hours/days (the one shared copy)", () => {
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
  test("CS-02 maps unconfigured/synced/skipped; skipped is an idle refresh, never an error", () => {
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
    expect(mapSyncOutcomeToState({ status: "skipped" }, {}, 1000)).toEqual({
      state: "idle",
      detail: "Never synced.",
    });
  });
});

describe("runManual", () => {
  test("CS-03 runs unconditionally, drains the outbox, stamps meta, and reports idle", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter();
    const session = createCloudSyncSession({
      loadAdapter: () => Promise.resolve(adapter),
      now: () => 12345,
    });

    const result = await session.runManual();

    expect(result).toEqual({
      outcome: { status: "synced", pushed: 1, pulled: 0, at: 12345 },
      state: "idle",
      detail: "Synced just now.",
    });
    expect(calls).toEqual({ isConfigured: 1, push: 1, pull: 1 });
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({ lastSyncAt: 12345 });
  });

  test("CS-04 an unconfigured adapter short-circuits to the unconfigured state, meta untouched", async () => {
    const { adapter, calls } = makeAdapter({ configured: false });
    const session = createCloudSyncSession({ loadAdapter: () => Promise.resolve(adapter) });

    const result = await session.runManual();

    expect(result).toEqual({
      outcome: { status: "unconfigured" },
      state: "unconfigured",
      detail: "",
    });
    expect(calls).toEqual({ isConfigured: 1, push: 0, pull: 0 });
    expect(storageFake.data[SYNC_META_KEY]).toBeUndefined();
  });

  test("CS-05 adapter errors propagate to the caller and release the in-flight guard", async () => {
    const { adapter } = makeAdapter({
      pull: async () => {
        throw new Error("pull boom");
      },
    });
    const session = createCloudSyncSession({ loadAdapter: () => Promise.resolve(adapter) });

    expect(await rejectionOf(session.runManual())).toEqual(new Error("pull boom"));
    expect(session.isInFlight()).toBe(false);
    // A failed sync must not wedge the guard shut — the retry affordance depends on it.
    expect(await rejectionOf(session.runManual())).toEqual(new Error("pull boom"));
  });

  test("CS-06 a second runManual while the first is in flight is a no-op returning null", async () => {
    let resolvePull: ((rows: RemoteAccount[]) => void) | undefined;
    const { adapter, calls } = makeAdapter({
      pull: () =>
        new Promise((resolve) => {
          resolvePull = resolve;
        }),
    });
    const session = createCloudSyncSession({
      loadAdapter: () => Promise.resolve(adapter),
      now: () => 7,
    });

    const first = session.runManual();
    expect(session.isInFlight()).toBe(true);
    expect(await session.runManual()).toBeNull();

    // Let the first sync's chain advance to the point where it is actually blocked on
    // our deferred pull promise before releasing it.
    await settleMicrotasks(50);
    resolvePull?.([]);
    const result = await first;
    expect(result?.outcome).toEqual({ status: "synced", pushed: 0, pulled: 0, at: 7 });
    expect(session.isInFlight()).toBe(false);
    expect(calls.pull).toBe(1);
  });
});

describe("runAutoOnOpen", () => {
  test("CS-07 fresh meta + empty outbox skips without EVER invoking loadAdapter (AC-01 mirror)", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    const session = createCloudSyncSession({ loadAdapter: forbiddenLoader, now: () => 1000 });

    const result = await session.runAutoOnOpen(true);

    expect(result).toEqual({
      outcome: { status: "skipped" },
      state: "idle",
      detail: "Synced just now.",
    });
  });

  test("CS-08 the configured probe is a separate port: it may run while the auto gate skips", async () => {
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
    const result = await session.runAutoOnOpen(true);

    expect(probeCalls).toBe(1);
    expect(result.outcome).toEqual({ status: "skipped" });
  });

  test("CS-09 pending actions make the gate proceed: adapter loads, onSyncStart fires, outbox pushes", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter, calls } = makeAdapter();
    let loaderCalls = 0;
    let hookCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: () => {
        loaderCalls += 1;
        return Promise.resolve(adapter);
      },
      now: () => 1000,
    });

    const result = await session.runAutoOnOpen(true, {
      onSyncStart: () => {
        hookCalls += 1;
      },
    });

    expect(result).toEqual({
      outcome: { status: "synced", pushed: 1, pulled: 0, at: 1000 },
      state: "idle",
      detail: "Synced just now.",
    });
    expect(loaderCalls).toBe(1);
    expect(hookCalls).toBe(1);
    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
    expect(session.isInFlight()).toBe(false);
  });

  test("CS-10 a stale last sync proceeds even with nothing pending", async () => {
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 1000 };
    const { adapter, calls } = makeAdapter();
    const staleNow = 1000 + SYNC_STALE_MS + 1;
    const session = createCloudSyncSession({
      loadAdapter: () => Promise.resolve(adapter),
      now: () => staleNow,
    });

    const result = await session.runAutoOnOpen(true);

    expect(result.outcome).toEqual({ status: "synced", pushed: 0, pulled: 0, at: staleNow });
    expect(result.state).toBe("idle");
    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(1);
  });

  test("CS-11 disabled backup skips (idle refresh from stored meta), never loading the adapter", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const session = createCloudSyncSession({ loadAdapter: forbiddenLoader, now: () => 1000 });

    const result = await session.runAutoOnOpen(false);

    expect(result).toEqual({
      outcome: { status: "skipped" },
      state: "idle",
      detail: "Never synced.",
    });
  });

  test("CS-12 a sync failure maps to the error state (not a rejection) and releases the guard", async () => {
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const { adapter } = makeAdapter({
      pull: async () => {
        throw new Error("open boom");
      },
    });
    const session = createCloudSyncSession({ loadAdapter: () => Promise.resolve(adapter) });

    const result = await session.runAutoOnOpen(true);

    expect(result).toEqual({ state: "error", detail: "" });
    expect(session.isInFlight()).toBe(false);
  });

  test("CS-13 an in-flight manual sync blocks the auto pass entirely: report syncing, gate never runs", async () => {
    // A pending outbox would make the gate proceed — the entry guard must win first.
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    let resolvePull: ((rows: RemoteAccount[]) => void) | undefined;
    const { adapter, calls } = makeAdapter({
      pull: () =>
        new Promise((resolve) => {
          resolvePull = resolve;
        }),
    });
    let loaderCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: () => {
        loaderCalls += 1;
        return Promise.resolve(adapter);
      },
      now: () => 7,
    });

    const manual = session.runManual();
    const auto = await session.runAutoOnOpen(true);

    expect(auto).toEqual({ state: "syncing", detail: "", outcome: { status: "skipped" } });
    expect(loaderCalls).toBe(1); // the manual sync's load only

    await settleMicrotasks(50);
    resolvePull?.([]);
    await manual;
    expect(calls.pull).toBe(1);
  });
});

describe("wipeCloud", () => {
  test("CS-14 wipe sequence: clearCloud, drain outbox, clear meta, backup off, local accounts untouched", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data[SYNC_META_KEY] = { lastSyncAt: 12345 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1"), pendingItem("a2")];
    storageFake.data["blockedAccounts"] = {
      "1": { key: "1", handle: "spammer", status: "active" },
    };
    let clearCalls = 0;
    const session = createCloudSyncSession({
      loadAdapter: forbiddenLoader,
      clearCloud: async () => {
        clearCalls += 1;
      },
    });

    const result = await session.wipeCloud();

    expect(clearCalls).toBe(1);
    expect(result).toEqual({ pendingCount: 0 });
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(storageFake.data[SYNC_META_KEY]).toEqual({});
    expect(storageFake.data["cloudBackup"]).toBe(false);
    expect(storageFake.data["blockedAccounts"]).toMatchObject({ "1": { handle: "spammer" } });
  });

  test("CS-15 a clearCloud failure propagates before any local side-effect runs", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const session = createCloudSyncSession({
      clearCloud: async () => {
        throw new Error("wipe boom");
      },
    });

    expect(await rejectionOf(session.wipeCloud())).toEqual(new Error("wipe boom"));
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    expect(storageFake.data["cloudBackup"]).toBe(true);
  });
});

describe("production default ports", () => {
  test("CS-16 defaults lazy-import convex-sync and short-circuit safely when unconfigured (no network)", async () => {
    // Mirror SE-08: force the deployment URL unset so the real module's isConfigured()
    // is false and every default port returns/throws before any network I/O.
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
      // The default wipe port reaches the real clearCloud, which refuses to construct a
      // client without a deployment URL — the wipe rejects before touching local state.
      storageFake.data["blockedOutbox"] = [pendingItem("a1")];
      expect(String(await rejectionOf(session.wipeCloud()))).toMatch(/not configured/);
      expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
    } finally {
      if (originalUrl !== undefined) process.env["VITE_CONVEX_URL"] = originalUrl;
    }
  });
});
