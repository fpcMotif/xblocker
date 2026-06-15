// Catalog: BS-* (blocked-merge pure dedup logic + BlockedStore over chrome.storage).
import { beforeEach, describe, expect, test } from "bun:test";

import {
  accountKeyFor,
  mergeBlockedAccount,
  summarizeAccounts,
  type BlockedAccount,
  type BlockedStats,
} from "../entrypoints/lib/blocked-merge.ts";
import {
  createBlockedStore,
  outboxItemToRecordArgs,
  type OutboxItem,
  type RecordActionArgs,
  type RemoteAccount,
} from "../entrypoints/lib/blocked-store.ts";
import { settleMicrotasks } from "./helpers/timers.ts";
import { storageFake } from "./setup.ts";

let counter = 0;
const fixedId = () => `action-${++counter}`;

/** Build a full BlockedAccount for summarize tests without unsafe casts. */
function mkAccount(
  partial: Partial<BlockedAccount> & Pick<BlockedAccount, "status" | "blockCount" | "muteCount">,
): BlockedAccount {
  return {
    key: "k",
    handle: "h",
    idUnknown: false,
    firstActionAt: 0,
    lastActionAt: 0,
    actions: [],
    ...partial,
  };
}

beforeEach(async () => {
  counter = 0;
  // Reset the shared in-memory storage area between tests.
  await chrome.storage.local.clear();
});

describe("mergeBlockedAccount (pure dedup logic)", () => {
  test("BS-01 creates one record for a brand-new block", () => {
    const account = mergeBlockedAccount(
      undefined,
      { handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" },
      1000,
      fixedId,
    );

    expect(account.key).toBe("111");
    expect(account.xUserId).toBe("111");
    expect(account.idUnknown).toBe(false);
    expect(account.blockCount).toBe(1);
    expect(account.muteCount).toBe(0);
    expect(account.status).toBe("active");
    expect(account.actions).toHaveLength(1);
  });

  test("BS-02 blocking the same id twice keeps one record and bumps the count", () => {
    const first = mergeBlockedAccount(
      undefined,
      { handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111", at: 1000 },
      1000,
      fixedId,
    );
    const second = mergeBlockedAccount(
      first,
      { handle: "spammer", kind: "block", source: "popup", xUserId: "111", at: 2000 },
      2000,
      fixedId,
    );

    expect(second.blockCount).toBe(2);
    expect(second.actions).toHaveLength(2);
    expect(second.key).toBe("111");
  });

  test("BS-03 block then mute on the same id is one record with both rollups", () => {
    const blocked = mergeBlockedAccount(
      undefined,
      { handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111", at: 1000 },
      1000,
      fixedId,
    );
    const muted = mergeBlockedAccount(
      blocked,
      { handle: "spammer", kind: "mute", source: "reply-bar", xUserId: "111", at: 2000 },
      2000,
      fixedId,
    );

    expect(muted.blockCount).toBe(1);
    expect(muted.muteCount).toBe(1);
    expect(muted.actions.map((a) => a.kind)).toEqual(["block", "mute"]);
  });

  test("BS-04 records which of your accounts performed each action", () => {
    const first = mergeBlockedAccount(
      undefined,
      {
        handle: "spammer",
        kind: "block",
        source: "reply-bar",
        xUserId: "111",
        fromAccount: "alt1",
      },
      1000,
      fixedId,
    );
    const second = mergeBlockedAccount(
      first,
      {
        handle: "spammer",
        kind: "block",
        source: "reply-bar",
        xUserId: "111",
        fromAccount: "alt2",
      },
      2000,
      fixedId,
    );

    expect(second.actions.map((a) => a.fromAccount)).toEqual(["alt1", "alt2"]);
  });

  test("BS-05 unblock flips status to unblocked without dropping history", () => {
    const blocked = mergeBlockedAccount(
      undefined,
      { handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111", at: 1000 },
      1000,
      fixedId,
    );
    const unblocked = mergeBlockedAccount(
      blocked,
      { handle: "spammer", kind: "unblock", source: "popup", xUserId: "111", at: 2000 },
      2000,
      fixedId,
    );

    expect(unblocked.status).toBe("unblocked");
    expect(unblocked.blockCount).toBe(1);
    expect(unblocked.actions).toHaveLength(2);
  });

  test("BS-06 a brand-new unblock starts unblocked", () => {
    const account = mergeBlockedAccount(
      undefined,
      { handle: "ghost", kind: "unblock", source: "popup", xUserId: "1" },
      1000,
      fixedId,
    );
    expect(account.status).toBe("unblocked");
  });

  test("BS-07 an out-of-order (older) action keeps the latest handle", () => {
    const latest = mergeBlockedAccount(
      undefined,
      { handle: "newname", kind: "block", source: "reply-bar", xUserId: "111", at: 2000 },
      2000,
      fixedId,
    );
    const older = mergeBlockedAccount(
      latest,
      { handle: "oldname", kind: "block", source: "reply-bar", xUserId: "111", at: 1000 },
      1000,
      fixedId,
    );
    // The older action must not clobber the newer display handle.
    expect(older.handle).toBe("newname");
    expect(older.firstActionAt).toBe(1000);
    expect(older.lastActionAt).toBe(2000);
  });

  test("BS-08 learns a numeric id for a record first seen by handle only", () => {
    const byHandle = mergeBlockedAccount(
      undefined,
      { handle: "Spammer", kind: "mute", source: "reply-bar", at: 1000 },
      1000,
      fixedId,
    );
    expect(byHandle.key).toBe("@spammer");
    expect(byHandle.idUnknown).toBe(true);

    const withId = mergeBlockedAccount(
      byHandle,
      { handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111", at: 2000 },
      2000,
      fixedId,
    );
    expect(withId.key).toBe("@spammer"); // map key stays stable
    expect(withId.xUserId).toBe("111");
    expect(withId.idUnknown).toBe(false);
  });

  test("BS-09 defaults the timestamp to `now` and generates an action id", () => {
    const account = mergeBlockedAccount(
      undefined,
      { handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" },
      4242,
      fixedId,
    );
    expect(account.firstActionAt).toBe(4242);
    expect(account.actions[0]?.actionId).toBe("action-1");
  });

  test("BS-10 accountKeyFor uses the id when present and a lowercased handle otherwise", () => {
    expect(accountKeyFor({ xUserId: "111", handle: "Foo" })).toBe("111");
    expect(accountKeyFor({ handle: "@Foo" })).toBe("@foo");
  });
});

describe("summarizeAccounts", () => {
  test("BS-11 counts active blocked and muted accounts", () => {
    const stats = summarizeAccounts([
      mkAccount({ status: "active", blockCount: 2, muteCount: 0 }),
      mkAccount({ status: "active", blockCount: 0, muteCount: 1 }),
      mkAccount({ status: "active", blockCount: 1, muteCount: 1 }),
      mkAccount({ status: "unblocked", blockCount: 1, muteCount: 0 }),
    ]);

    expect(stats.accounts).toBe(4);
    expect(stats.blocked).toBe(2);
    expect(stats.muted).toBe(2);
  });
});

describe("BlockedStore (through chrome.storage.local)", () => {
  test("BS-12 records the same id twice as one account with two actions", async () => {
    const store = createBlockedStore();

    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "block", source: "popup", xUserId: "111" });

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.blockCount).toBe(2);
    expect(list[0]!.actions).toHaveLength(2);
  });

  test("BS-13 block then mute on the same id is one account row", async () => {
    const store = createBlockedStore();

    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "mute", source: "reply-bar", xUserId: "111" });

    const account = await store.get("111");
    expect(account?.blockCount).toBe(1);
    expect(account?.muteCount).toBe(1);
  });

  test("BS-14 hasActiveHandle finds a blocked account by screen name", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "Spammer", kind: "block", source: "reply-bar", xUserId: "111" });

    expect(await store.hasActiveHandle("spammer")).toBe(true);
    expect(await store.hasActiveHandle("@SPAMMER")).toBe(true);
    expect(await store.hasActiveHandle("someoneelse")).toBe(false);
  });

  test("BS-15 hasActiveHandle ignores unblocked accounts", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "unblock", source: "popup", xUserId: "111" });

    expect(await store.hasActiveHandle("spammer")).toBe(false);
  });

  test("BS-16 stats reflect recorded blocks and mutes", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "a", kind: "block", source: "reply-bar", xUserId: "1" });
    await store.record({ handle: "b", kind: "mute", source: "reply-bar", xUserId: "2" });

    const stats = await store.stats();
    expect(stats).toEqual({ accounts: 2, blocked: 1, muted: 1 });
  });

  test("BS-17 queues actions in the outbox and clears them once synced", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "mute", source: "reply-bar", xUserId: "111" });

    const pending = await store.pending();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.xUserId).toBe("111");

    await store.markSynced([pending[0]!.action.actionId]);
    const after = await store.pending();
    expect(after).toHaveLength(1);
    expect(after[0]!.action.actionId).toBe(pending[1]!.action.actionId);
  });

  test("BS-18 mergeRemote unions cloud accounts that are not present locally", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "local", kind: "block", source: "reply-bar", xUserId: "1" });

    await store.mergeRemote([
      {
        xUserId: "2",
        handle: "remote",
        idUnknown: false,
        firstActionAt: 10,
        lastActionAt: 20,
        blockCount: 3,
        muteCount: 0,
        status: "active",
      },
    ]);

    const list = await store.list();
    expect(list).toHaveLength(2);
    const remote = await store.get("2");
    expect(remote?.blockCount).toBe(3);
    expect(remote?.handle).toBe("remote");
  });
});

describe("BlockedStore edge cases", () => {
  test("BS-19 has() reports membership by key", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });

    expect(await store.has("111")).toBe(true);
    expect(await store.has("999")).toBe(false);
  });

  test("BS-20 generates a non-crypto id when crypto.randomUUID is unavailable", async () => {
    const store = createBlockedStore();
    const originalCrypto = globalThis.crypto;
    // Force genId down its non-crypto fallback branch.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const account = await store.record({ handle: "noid", kind: "block", source: "reply-bar" });
      expect(account.actions[0]?.actionId).toBeTruthy();
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
    }
  });

  test("BS-21 markSynced is a no-op for an empty id list", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "1" });

    await store.markSynced([]);
    expect(await store.pending()).toHaveLength(1);
  });

  test("BS-22 mergeRemote returns early when there is nothing to merge", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "local", kind: "block", source: "reply-bar", xUserId: "1" });

    await store.mergeRemote([]);
    expect(await store.list()).toHaveLength(1);
  });

  test("BS-23 mergeRemote rolls a newer remote row into the matching local account", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "1" });

    await store.mergeRemote([
      {
        xUserId: "1",
        handle: "renamed",
        idUnknown: false,
        firstActionAt: 1,
        lastActionAt: Date.now() + 60_000,
        blockCount: 5,
        muteCount: 2,
        status: "active",
      },
    ]);

    const account = await store.get("1");
    expect(account?.blockCount).toBe(5);
    expect(account?.muteCount).toBe(2);
    expect(account?.handle).toBe("renamed"); // remote row is newer, so its handle wins
  });

  test("BS-24 mergeRemote matches a handle-keyed local record by its learned id", async () => {
    const store = createBlockedStore();
    // First seen with no id (stored under the "@handle" key)...
    await store.record({ handle: "ghost", kind: "block", source: "reply-bar" });
    // ...then learned the numeric id (the record stays under the "@handle" key).
    await store.record({ handle: "ghost", kind: "block", source: "popup", xUserId: "1" });

    await store.mergeRemote([
      {
        xUserId: "1",
        handle: "ghost",
        idUnknown: false,
        firstActionAt: 1,
        lastActionAt: 2,
        blockCount: 9,
        muteCount: 0,
        status: "active",
      },
    ]);

    const list = await store.list();
    // Matched the existing handle-keyed record rather than creating a duplicate.
    expect(list).toHaveLength(1);
    expect(list[0]?.blockCount).toBe(9);
  });

  test("BS-25 onChange forwards local blockedAccounts changes to the subscriber", () => {
    const store = createBlockedStore();
    const listeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void> = [];
    const fakeOnChanged = {
      addListener(fn: (c: Record<string, { newValue?: unknown }>, area: string) => void) {
        listeners.push(fn);
      },
      removeListener(fn: (c: Record<string, { newValue?: unknown }>, area: string) => void) {
        const index = listeners.indexOf(fn);
        if (index !== -1) listeners.splice(index, 1);
      },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install a runtime onChanged fake the static chrome typings don't model.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    chromeStorage["onChanged"] = fakeOnChanged;
    try {
      const seen: BlockedStats[] = [];
      const unsubscribe = store.onChange((stats) => seen.push(stats));

      const map = {
        "1": {
          key: "1",
          handle: "spammer",
          idUnknown: false,
          xUserId: "1",
          firstActionAt: 1,
          lastActionAt: 1,
          blockCount: 1,
          muteCount: 0,
          status: "active",
          actions: [],
        },
      };
      const fire = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        for (const listener of listeners) listener(changes, area);
      };
      // A change in another storage area is ignored.
      fire({ blockedAccounts: { newValue: map } }, "sync");
      // A non-object payload summarizes to an empty set.
      fire({ blockedAccounts: { newValue: 42 } }, "local");
      // A real local map is summarized and forwarded.
      fire({ blockedAccounts: { newValue: map } }, "local");

      expect(seen).toEqual([
        { accounts: 0, blocked: 0, muted: 0 },
        { accounts: 1, blocked: 1, muted: 0 },
      ]);

      unsubscribe();
      expect(listeners).toHaveLength(0);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
    }
  });

  test("BS-26 onChange is inert when chrome.storage.onChanged is unavailable", () => {
    const store = createBlockedStore();
    const unsubscribe = store.onChange(() => {
      throw new Error("should never fire without an onChanged API");
    });
    // Returns a usable no-op unsubscribe.
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("outboxItemToRecordArgs (cloud key mapping)", () => {
  const baseAction = { actionId: "a1", kind: "block", at: 5, source: "reply-bar" } as const;

  test("BS-27 keys by the numeric id and omits aliasKey when id-first", () => {
    const item: OutboxItem = {
      accountKey: "1",
      xUserId: "1",
      handle: "spammer",
      idUnknown: false,
      action: baseAction,
    };
    const args = outboxItemToRecordArgs(item);
    expect(args.xUserId).toBe("1");
    expect(args.aliasKey).toBeUndefined();
    expect(args.idUnknown).toBe(false);
    expect(args.clientActionId).toBe("a1");
  });

  test("BS-28 keys by @handle and omits aliasKey when the id is still unknown", () => {
    const item: OutboxItem = {
      accountKey: "@ghost",
      handle: "ghost",
      idUnknown: true,
      action: baseAction,
    };
    const args = outboxItemToRecordArgs(item);
    expect(args.xUserId).toBe("@ghost");
    expect(args.aliasKey).toBeUndefined();
    expect(args.idUnknown).toBe(true);
  });

  test("BS-29 sends aliasKey once an id is learned for a handle-first account", () => {
    const item: OutboxItem = {
      accountKey: "@ghost",
      xUserId: "1",
      handle: "ghost",
      idUnknown: false,
      action: baseAction,
    };
    const args = outboxItemToRecordArgs(item);
    expect(args.xUserId).toBe("1");
    expect(args.aliasKey).toBe("@ghost");
  });

  test("BS-30 passes through which of your accounts performed the action", () => {
    const item: OutboxItem = {
      accountKey: "1",
      xUserId: "1",
      handle: "spammer",
      idUnknown: false,
      action: { ...baseAction, fromAccount: "alt1" },
    };
    const args = outboxItemToRecordArgs(item);
    expect(args.fromAccount).toBe("alt1");
  });
});

describe("cloud round-trip parity", () => {
  test("BS-31 mergeRemote folds a remote id-row into a handle-only local record by screen name", async () => {
    const store = createBlockedStore();
    // Recorded with no id -> stored under "@ghost", idUnknown.
    await store.record({ handle: "ghost", kind: "block", source: "reply-bar" });

    // The cloud later returns the same person keyed by the numeric id (learned elsewhere).
    await store.mergeRemote([
      {
        xUserId: "1",
        handle: "Ghost",
        idUnknown: false,
        firstActionAt: 1,
        lastActionAt: 2,
        blockCount: 1,
        muteCount: 0,
        status: "active",
      },
    ]);

    const list = await store.list();
    expect(list).toHaveLength(1); // folded in, not duplicated
    expect(list[0]!.xUserId).toBe("1"); // adopted the learned id
    expect(list[0]!.idUnknown).toBe(false);
  });

  // A minimal stand-in for convex/blocked.ts recordAction: it pins the contract that
  // outboxItemToRecordArgs targets (upsert on xUserId + aliasKey migration), so the
  // client mapping and the backend stay in agreement even though the real mutation runs
  // in the Convex runtime, not here.
  function makeFakeCloud() {
    const rows = new Map<string, RemoteAccount>();
    const seen = new Set<string>();
    return {
      recordAction(args: RecordActionArgs): void {
        if (seen.has(args.clientActionId)) return;
        seen.add(args.clientActionId);

        let row = rows.get(args.xUserId);
        if (args.aliasKey && args.aliasKey !== args.xUserId) {
          const alias = rows.get(args.aliasKey);
          if (alias) {
            rows.delete(args.aliasKey);
            if (!row) {
              row = { ...alias, xUserId: args.xUserId, idUnknown: false };
              rows.set(args.xUserId, row);
            } else {
              row.firstActionAt = Math.min(row.firstActionAt, alias.firstActionAt);
              row.lastActionAt = Math.max(row.lastActionAt, alias.lastActionAt);
              row.blockCount += alias.blockCount;
              row.muteCount += alias.muteCount;
              row.idUnknown = row.idUnknown && alias.idUnknown;
            }
          }
        }

        const status = args.kind === "unblock" ? "unblocked" : "active";
        if (!row) {
          rows.set(args.xUserId, {
            xUserId: args.xUserId,
            handle: args.handle,
            idUnknown: args.idUnknown,
            firstActionAt: args.at,
            lastActionAt: args.at,
            blockCount: args.kind === "block" ? 1 : 0,
            muteCount: args.kind === "mute" ? 1 : 0,
            status,
          });
          return;
        }
        row.handle = args.at >= row.lastActionAt ? args.handle : row.handle;
        row.idUnknown = row.idUnknown && args.idUnknown;
        row.firstActionAt = Math.min(row.firstActionAt, args.at);
        row.lastActionAt = Math.max(row.lastActionAt, args.at);
        row.blockCount += args.kind === "block" ? 1 : 0;
        row.muteCount += args.kind === "mute" ? 1 : 0;
        row.status = status;
      },
      listBlocked(): RemoteAccount[] {
        return structuredClone(Array.from(rows.values()));
      },
    };
  }

  test("BS-32 a handle-then-id push lands as one cloud row that a fresh device sees once", async () => {
    const deviceA = createBlockedStore();
    await deviceA.record({ handle: "ghost", kind: "mute", source: "reply-bar" }); // no id yet
    await deviceA.record({ handle: "ghost", kind: "block", source: "reply-bar", xUserId: "1" });

    const cloud = makeFakeCloud();
    for (const item of await deviceA.pending()) {
      cloud.recordAction(outboxItemToRecordArgs(item));
    }

    const remote = cloud.listBlocked();
    expect(remote).toHaveLength(1); // the @handle row was folded into the numeric one
    expect(remote[0]!.xUserId).toBe("1");

    // A second device that only pulls must reconstruct exactly one account.
    await chrome.storage.local.clear();
    const deviceB = createBlockedStore();
    await deviceB.mergeRemote(remote);

    const list = await deviceB.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.xUserId).toBe("1");
    expect(list[0]!.idUnknown).toBe(false);
    expect(list[0]!.blockCount).toBe(1);
    expect(list[0]!.muteCount).toBe(1);
  });
});

describe("BlockedStore serialized mutations (XB-BUG-08 family)", () => {
  test("BS-33 serializes concurrent record() calls so no account or outbox entry is lost", async () => {
    // Mutations run through a single promise chain: the second record does not
    // read until the first write lands, so last-write-wins clobbering is gone.
    const store = createBlockedStore();
    // reset() gives a clean call log + sync baseline; the trailing reset() restores
    // sync dispatch so the manual mode does not leak into the next test.
    storageFake.reset();
    storageFake.useManualDispatch();
    try {
      const first = store.record({
        handle: "first",
        kind: "block",
        source: "reply-bar",
        xUserId: "1",
      });
      const second = store.record({
        handle: "second",
        kind: "block",
        source: "reply-bar",
        xUserId: "2",
      });
      await settleMicrotasks();

      // Only the first mutation's read is in flight; the second is queued.
      expect(storageFake.getCalls).toHaveLength(1);

      for (let round = 0; round < 6; round++) {
        storageFake.flush();
        await settleMicrotasks();
      }

      expect((await first).key).toBe("1");
      expect((await second).key).toBe("2");

      // Both accounts persisted, and both actions landed in the outbox. list()/pending()
      // are read-only reads that still queue under manual dispatch, so settle them too.
      const listPromise = store.list();
      const pendingPromise = store.pending();
      for (let round = 0; round < 4; round++) {
        storageFake.flush();
        await settleMicrotasks();
      }
      expect((await listPromise).map((account) => account.key).toSorted()).toEqual(["1", "2"]);
      expect((await pendingPromise).map((item) => item.accountKey).toSorted()).toEqual(["1", "2"]);
    } finally {
      storageFake.reset();
    }
  });

  test("BS-34 a failed mutation does not wedge the chain for later mutations", async () => {
    // Both mutations are enqueued before either settles, so the recovering one
    // only runs if the chain advances PAST the rejected one. This pins the
    // `mutationChain = run.catch(...)` recovery: with a plain `mutationChain = run`
    // the second mutation chains off a rejected promise, its body is skipped, and
    // "ok" is never written — so the assertions below would fail.
    const store = createBlockedStore();
    storageFake.failNextGet = true;

    const failing = store.record({
      handle: "boom",
      kind: "block",
      source: "reply-bar",
      xUserId: "1",
    });
    const recovering = store.record({
      handle: "ok",
      kind: "block",
      source: "reply-bar",
      xUserId: "2",
    });

    let failingRejected = false;
    await failing.catch(() => {
      failingRejected = true;
    });
    expect(failingRejected).toBe(true);

    const account = await recovering;
    expect(account.key).toBe("2");
    expect(await store.has("2")).toBe(true);
    // The failed mutation wrote nothing; only the recovering account persists.
    expect(await store.has("1")).toBe(false);
  });

  test("BS-35 serializes a record() against a concurrent mergeRemote() with no lost update", async () => {
    // The real production race is cross-method: the content script's record() and
    // the popup sync's mergeRemote() both read-modify-write blockedAccounts. If
    // either wrapper is dropped they read the same empty map and the second write
    // clobbers the first; serialized, the second reads after the first lands.
    const store = createBlockedStore();
    storageFake.reset();
    storageFake.useManualDispatch();
    try {
      const recorded = store.record({
        handle: "local",
        kind: "block",
        source: "reply-bar",
        xUserId: "1",
      });
      const merged = store.mergeRemote([
        {
          xUserId: "2",
          handle: "remote",
          idUnknown: false,
          firstActionAt: 1,
          lastActionAt: 2,
          blockCount: 1,
          muteCount: 0,
          status: "active",
        },
      ]);
      await settleMicrotasks();

      // Only the first mutation's read is in flight; the second waits its turn.
      expect(storageFake.getCalls).toHaveLength(1);

      for (let round = 0; round < 6; round++) {
        storageFake.flush();
        await settleMicrotasks();
      }
      await recorded;
      await merged;

      const listPromise = store.list();
      for (let round = 0; round < 4; round++) {
        storageFake.flush();
        await settleMicrotasks();
      }
      // Both the recorded and the merged account survive — neither write was lost.
      expect((await listPromise).map((account) => account.key).toSorted()).toEqual(["1", "2"]);
    } finally {
      storageFake.reset();
    }
  });
});
