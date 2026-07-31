import { beforeEach, describe, expect, test } from "bun:test";

import {
  blockedStore,
  type OutboxItem,
  type RemoteAccount,
} from "../entrypoints/lib/blocked-store.ts";
import {
  createCloudBackup,
  loadConvexAdapter,
  type CloudAdapter,
  type CloudBackupSnapshot,
} from "../entrypoints/lib/cloud-backup.ts";
import type { ExclusiveRunner } from "../entrypoints/lib/exclusive-lock.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

function makeAdapter(overrides: Partial<CloudAdapter> = {}): CloudAdapter {
  return {
    push: async (items) => items.map((item) => item.action.actionId),
    pull: async (): Promise<RemoteAccount[]> => [],
    clear: async () => {},
    ...overrides,
  };
}

function configuredSnapshot(
  overrides: Partial<Extract<CloudBackupSnapshot, { availability: "configured" }>> = {},
): CloudBackupSnapshot {
  return {
    availability: "configured",
    enabled: false,
    pendingActions: 0,
    lastSyncedAt: null,
    ...overrides,
  };
}

function pendingItem(actionId: string): OutboxItem {
  return {
    accountKey: "1",
    xUserId: "1",
    handle: "spammer",
    idUnknown: false,
    action: { actionId, kind: "block", at: 1, source: "reply-bar" },
  };
}

function createSerialRunner(): ExclusiveRunner {
  let chain: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = chain.then(operation);
    chain = run.catch(() => undefined);
    return run;
  };
}

beforeEach(() => {
  resetTestEnvironment();
});

describe("Cloud backup module", () => {
  test("CB-00 the lazy production loader exposes the transport seam", async () => {
    const adapter = await loadConvexAdapter();
    expect(Object.keys(adapter).toSorted()).toEqual(["clear", "pull", "push"]);
  });

  test("CB-01 inspect projects state without loading the network adapter", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: 42 };
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    let loads = 0;
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      loadAdapter: () => {
        loads += 1;
        return Promise.resolve(makeAdapter());
      },
    });

    expect(await cloudBackup.inspect()).toEqual(
      configuredSnapshot({ enabled: true, pendingActions: 1, lastSyncedAt: 42 }),
    );
    expect(loads).toBe(0);
  });

  test("CB-02 unconfigured inspection is one explicit state", async () => {
    const cloudBackup = createCloudBackup({ isConfigured: () => false });
    expect(await cloudBackup.inspect()).toEqual({ availability: "unconfigured" });
  });

  test("CB-03 automatic sync skips disabled and fresh backups without loading transport", async () => {
    let loads = 0;
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      now: () => 1_000_000,
      loadAdapter: () => {
        loads += 1;
        return Promise.resolve(makeAdapter());
      },
    });

    expect(await cloudBackup.act({ kind: "sync", trigger: "automatic" })).toEqual({
      outcome: "skipped",
      reason: "disabled",
      snapshot: configuredSnapshot(),
    });
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: 999_999 };
    expect(await cloudBackup.act({ kind: "sync", trigger: "automatic" })).toEqual({
      outcome: "skipped",
      reason: "fresh",
      snapshot: configuredSnapshot({ enabled: true, lastSyncedAt: 999_999 }),
    });
    expect(loads).toBe(0);
  });

  test("CB-04 pending automatic sync and manual sync share push-pull policy", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const calls: string[] = [];
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      now: () => 123,
      loadAdapter: () =>
        Promise.resolve(
          makeAdapter({
            push: async (items) => {
              calls.push("push");
              return items.map((item) => item.action.actionId);
            },
            pull: async () => {
              calls.push("pull");
              return [];
            },
          }),
        ),
    });

    expect(await cloudBackup.act({ kind: "sync", trigger: "automatic" })).toEqual({
      outcome: "synced",
      pushed: 1,
      pulled: 0,
      at: 123,
      snapshot: configuredSnapshot({ enabled: true, lastSyncedAt: 123 }),
    });
    expect(calls).toEqual(["push", "pull"]);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
  });

  test("CB-05 stale automatic sync pulls and merges remote state", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: 1 };
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      now: () => 2_000_000,
      loadAdapter: () =>
        Promise.resolve(
          makeAdapter({
            pull: async () => [
              {
                xUserId: "7",
                handle: "remote",
                idUnknown: false,
                status: "active",
                blockCount: 1,
                muteCount: 0,
                unblockCount: 0,
                firstActionAt: 10,
                lastActionAt: 10,
              },
            ],
          }),
        ),
    });

    const result = await cloudBackup.act({ kind: "sync", trigger: "automatic" });
    expect(result.outcome).toBe("synced");
    expect(await blockedStore.get("7")).toMatchObject({ handle: "remote", blockCount: 1 });
    expect(storageFake.data["cloudSyncMeta"]).toEqual({ lastSyncAt: 2_000_000 });
  });

  test("CB-06 set-enabled persists and returns the resulting projection", async () => {
    const cloudBackup = createCloudBackup({ isConfigured: () => true });
    expect(await cloudBackup.act({ kind: "set-enabled", enabled: true })).toEqual({
      outcome: "updated",
      snapshot: configuredSnapshot({ enabled: true }),
    });
  });

  test("CB-07 wipe drains its starting cutoff, disables first, and returns final state", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["cloudSyncMeta"] = { lastSyncAt: 42 };
    storageFake.data["blockedOutbox"] = [pendingItem("before")];
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      loadAdapter: () =>
        Promise.resolve(
          makeAdapter({
            clear: async () => {
              expect(storageFake.data["cloudBackup"]).toBe(false);
              storageFake.data["blockedOutbox"] = [pendingItem("before"), pendingItem("during")];
            },
          }),
        ),
    });

    expect(await cloudBackup.act({ kind: "wipe" })).toEqual({
      outcome: "wiped",
      snapshot: configuredSnapshot({ pendingActions: 1 }),
    });
    expect((await blockedStore.pending()).map((item) => item.action.actionId)).toEqual(["during"]);
  });

  test("CB-08 a local failure after remote clear rejects and leaves backup safely disabled", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      loadAdapter: () =>
        Promise.resolve(
          makeAdapter({
            clear: async () => {
              storageFake.failNextSet = true;
            },
          }),
        ),
    });

    const wipeError = await cloudBackup.act({ kind: "wipe" }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(wipeError).toBe("storage write failed");
    expect(storageFake.data["cloudBackup"]).toBe(false);
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
  });

  test("CB-09 one failing operation does not wedge the serialization chain", async () => {
    let attempts = 0;
    const cloudBackup = createCloudBackup({
      isConfigured: () => true,
      loadAdapter: () =>
        Promise.resolve(
          makeAdapter({
            pull: async () => {
              attempts += 1;
              if (attempts === 1) throw new Error("offline");
              return [];
            },
          }),
        ),
    });

    const syncError = await cloudBackup.act({ kind: "sync", trigger: "manual" }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(syncError).toBe("offline");
    expect((await cloudBackup.act({ kind: "sync", trigger: "manual" })).outcome).toBe("synced");
  });

  test("CB-10 shared ownership prevents a sync from repopulating cloud after wipe", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const remote: string[] = [];
    let releasePush: (() => void) | undefined;
    const pushStarted = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    let allowPush: (() => void) | undefined;
    const pushBarrier = new Promise<void>((resolve) => {
      allowPush = resolve;
    });
    const adapter = makeAdapter({
      push: async (items) => {
        releasePush?.();
        await pushBarrier;
        remote.push(...items.map((item) => item.action.actionId));
        return items.map((item) => item.action.actionId);
      },
      clear: async () => {
        remote.length = 0;
      },
    });
    const runExclusive = createSerialRunner();
    const deps = {
      isConfigured: () => true,
      loadAdapter: () => Promise.resolve(adapter),
      runExclusive,
    };
    const background = createCloudBackup(deps);
    const options = createCloudBackup(deps);

    const syncing = background.act({ kind: "sync", trigger: "automatic" });
    await pushStarted;
    const wiping = options.act({ kind: "wipe" });
    allowPush?.();
    await syncing;
    expect((await wiping).outcome).toBe("wiped");
    expect(remote).toEqual([]);
    expect(storageFake.data["cloudBackup"]).toBe(false);
  });

  test("CB-11 unconfigured manual sync and wipe do not touch local state", async () => {
    storageFake.data["cloudBackup"] = true;
    storageFake.data["blockedOutbox"] = [pendingItem("a1")];
    const cloudBackup = createCloudBackup({ isConfigured: () => false });

    for (const intent of [
      { kind: "sync", trigger: "manual" } as const,
      { kind: "wipe" } as const,
    ]) {
      expect(await cloudBackup.act(intent)).toEqual({
        outcome: "skipped",
        reason: "unconfigured",
        snapshot: { availability: "unconfigured" },
      });
    }
    expect(storageFake.data["cloudBackup"]).toBe(true);
    expect(storageFake.data["blockedOutbox"]).toHaveLength(1);
  });
});
