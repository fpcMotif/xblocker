// Catalog: BS-* (blocked-merge pure dedup logic + BlockedStore over chrome.storage).
import { beforeEach, describe, expect, test } from "bun:test";

import {
  accountKeyFor,
  applyAccountRollup,
  foldAccountSnapshot,
  mergeBlockedAccount,
  sumAccountRollups,
  summarizeAccounts,
  type AccountRollup,
  type BlockedAccount,
  type BlockedStats,
  type RemoteAccountSnapshot,
} from "../blocked-merge.ts";
import { createBlockedStore, type RemoteAccount } from "../blocked-store.ts";
import { outboxItemToRecordArgs, type RecordActionArgs } from "../../sync/cloud-wire.ts";
import { settleMicrotasks } from "../../../test/helpers/timers.ts";
import { storageFake } from "../../../test/setup.ts";

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

/** Build a remote account snapshot for foldAccountSnapshot tests. */
function mkSnapshot(
  partial: Partial<RemoteAccountSnapshot> &
    Pick<RemoteAccountSnapshot, "blockCount" | "muteCount" | "status">,
): RemoteAccountSnapshot {
  return {
    xUserId: "111",
    handle: "h",
    idUnknown: false,
    firstActionAt: 0,
    lastActionAt: 0,
    ...partial,
  };
}

/** Build a full AccountRollup for applyAccountRollup/sumAccountRollups tests. */
function mkRollup(
  partial: Partial<AccountRollup> & Pick<AccountRollup, "blockCount" | "muteCount" | "status">,
): AccountRollup {
  return {
    handle: "h",
    idUnknown: false,
    firstActionAt: 0,
    lastActionAt: 0,
    ...partial,
  };
}

beforeEach(async () => {
  counter = 0;
  // Reset the shared in-memory storage area between tests.
  await chrome.storage.local.clear();
});

describe("foldAccountSnapshot (pure remote reconcile)", () => {
  test("BS-FOLD-01 heals a behind-side with max counts and min/max timestamps", () => {
    const local = mkAccount({
      key: "111",
      xUserId: "111",
      blockCount: 1,
      muteCount: 0,
      status: "active",
      firstActionAt: 500,
      lastActionAt: 1000,
    });
    const merged = foldAccountSnapshot(
      local,
      mkSnapshot({
        blockCount: 3,
        muteCount: 2,
        status: "active",
        firstActionAt: 200,
        lastActionAt: 900,
      }),
    );

    // Counts take the max (never the sum) and the window spans both sides.
    expect(merged.blockCount).toBe(3);
    expect(merged.muteCount).toBe(2);
    expect(merged.firstActionAt).toBe(200);
    expect(merged.lastActionAt).toBe(1000);
  });

  test("BS-FOLD-02 the newer lastActionAt side wins handle and status", () => {
    const local = mkAccount({
      key: "111",
      xUserId: "111",
      handle: "old",
      blockCount: 1,
      muteCount: 0,
      status: "active",
      lastActionAt: 1000,
    });
    const remoteNewer = foldAccountSnapshot(
      local,
      mkSnapshot({
        handle: "new",
        status: "unblocked",
        blockCount: 1,
        muteCount: 0,
        lastActionAt: 2000,
      }),
    );
    expect(remoteNewer.handle).toBe("new");
    expect(remoteNewer.status).toBe("unblocked");

    const remoteOlder = foldAccountSnapshot(
      local,
      mkSnapshot({
        handle: "stale",
        status: "unblocked",
        blockCount: 1,
        muteCount: 0,
        lastActionAt: 500,
      }),
    );
    expect(remoteOlder.handle).toBe("old");
    expect(remoteOlder.status).toBe("active");
  });

  test("BS-FOLD-03 adopts a real remote id but never a handle-keyed pseudo-id", () => {
    const handleLocal = mkAccount({
      key: "@spam",
      handle: "spam",
      idUnknown: true,
      blockCount: 1,
      muteCount: 0,
      status: "active",
    });

    const learned = foldAccountSnapshot(
      handleLocal,
      mkSnapshot({
        xUserId: "999",
        idUnknown: false,
        blockCount: 1,
        muteCount: 0,
        status: "active",
      }),
    );
    expect(learned.xUserId).toBe("999");
    expect(learned.idUnknown).toBe(false);

    // A still-handle-keyed remote row stores "@handle" in xUserId; that pseudo-id must
    // not be adopted as a real id, and idUnknown stays true while both sides lack one.
    const stillUnknown = foldAccountSnapshot(
      handleLocal,
      mkSnapshot({
        xUserId: "@spam",
        idUnknown: true,
        blockCount: 1,
        muteCount: 0,
        status: "active",
      }),
    );
    expect(stillUnknown.xUserId).toBeUndefined();
    expect(stillUnknown.idUnknown).toBe(true);
  });
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

// Direct unit tests for the shared ledger algebra (docs/adr/0002-shared-ledger-algebra.md):
// applyAccountRollup is the "+1" operator mergeBlockedAccount wraps, sumAccountRollups is
// the "SUM" operator convex/blocked.ts's alias-row fold delegates to. They must never be
// conflated with each other or with foldAccountSnapshot's "max" (tested above).
describe("applyAccountRollup / sumAccountRollups (shared ledger algebra)", () => {
  test("BS-40 applyAccountRollup +1s the counter matching the action's kind", () => {
    const blocked = applyAccountRollup(undefined, {
      handle: "spammer",
      idUnknown: false,
      xUserId: "111",
      kind: "block",
      at: 1000,
    });
    expect(blocked.blockCount).toBe(1);
    expect(blocked.muteCount).toBe(0);

    const muted = applyAccountRollup(blocked, {
      handle: "spammer",
      idUnknown: false,
      xUserId: "111",
      kind: "mute",
      at: 2000,
    });
    expect(muted.blockCount).toBe(1);
    expect(muted.muteCount).toBe(1);
  });

  test("BS-41 applyAccountRollup folds min(firstActionAt) and max(lastActionAt) across out-of-order actions", () => {
    const latest = applyAccountRollup(undefined, {
      handle: "a",
      idUnknown: false,
      xUserId: "1",
      kind: "block",
      at: 2000,
    });
    const folded = applyAccountRollup(latest, {
      handle: "a",
      idUnknown: false,
      xUserId: "1",
      kind: "block",
      at: 500,
    });
    expect(folded.firstActionAt).toBe(500);
    expect(folded.lastActionAt).toBe(2000);
  });

  test("BS-42 applyAccountRollup clears idUnknown (AND) only once an input carries a known id", () => {
    const unknown = applyAccountRollup(undefined, {
      handle: "ghost",
      idUnknown: true,
      kind: "mute",
      at: 1,
    });
    expect(unknown.idUnknown).toBe(true);

    // Still no id on this input -> AND keeps it unknown.
    const stillUnknown = applyAccountRollup(unknown, {
      handle: "ghost",
      idUnknown: true,
      kind: "mute",
      at: 2,
    });
    expect(stillUnknown.idUnknown).toBe(true);

    // An input carrying a known id clears it (AND with idUnknown: false is always false).
    const learned = applyAccountRollup(unknown, {
      handle: "ghost",
      idUnknown: false,
      xUserId: "1",
      kind: "block",
      at: 3,
    });
    expect(learned.idUnknown).toBe(false);
    expect(learned.xUserId).toBe("1");
  });

  test("BS-43 applyAccountRollup: the newer action's `at` wins the handle, but status always reflects this action's own kind", () => {
    const base = applyAccountRollup(undefined, {
      handle: "newname",
      idUnknown: false,
      xUserId: "1",
      kind: "unblock",
      at: 2000,
    });
    // An older action must not clobber the newer display handle...
    const older = applyAccountRollup(base, {
      handle: "oldname",
      idUnknown: false,
      xUserId: "1",
      kind: "block",
      at: 1000,
    });
    expect(older.handle).toBe("newname");
    // ...but status is NOT "newer wins": it always reflects the just-applied action.
    expect(older.status).toBe("active");
  });

  test("BS-44 applyAccountRollup does not mutate its `existing` argument", () => {
    const existing = applyAccountRollup(undefined, {
      handle: "a",
      idUnknown: false,
      xUserId: "1",
      kind: "block",
      at: 1,
    });
    const snapshot = structuredClone(existing);
    applyAccountRollup(existing, {
      handle: "a",
      idUnknown: false,
      xUserId: "1",
      kind: "block",
      at: 2,
    });
    expect(existing).toEqual(snapshot);
  });

  test("BS-45 sumAccountRollups SUMs counters and folds min/max timestamps, AND-ing idUnknown", () => {
    const target = mkRollup({
      blockCount: 1,
      muteCount: 0,
      status: "active",
      idUnknown: false,
      firstActionAt: 300,
      lastActionAt: 900,
    });
    const alias = mkRollup({
      blockCount: 2,
      muteCount: 1,
      status: "active",
      idUnknown: true,
      firstActionAt: 100,
      lastActionAt: 400,
    });
    const summed = sumAccountRollups(target, alias);
    expect(summed.blockCount).toBe(3);
    expect(summed.muteCount).toBe(1);
    expect(summed.firstActionAt).toBe(100);
    expect(summed.lastActionAt).toBe(900);
    expect(summed.idUnknown).toBe(false); // target's false ANDs the alias's true down to false
  });

  test('BS-46 sumAccountRollups keeps the target\'s own handle/status/xUserId ("target wins", not "newer wins")', () => {
    const target = mkRollup({
      handle: "numeric-row",
      xUserId: "1",
      status: "active",
      blockCount: 1,
      muteCount: 0,
      lastActionAt: 100,
    });
    const alias = mkRollup({
      handle: "legacy-handle-row",
      xUserId: "@legacy",
      status: "unblocked",
      blockCount: 1,
      muteCount: 0,
      lastActionAt: 9999, // the alias is "newer" by timestamp, yet still loses
    });
    const summed = sumAccountRollups(target, alias);
    expect(summed.handle).toBe("numeric-row");
    expect(summed.status).toBe("active");
    expect(summed.xUserId).toBe("1");
  });

  test("BS-47 sumAccountRollups does not mutate either input", () => {
    const target = mkRollup({ blockCount: 1, muteCount: 0, status: "active" });
    const alias = mkRollup({ blockCount: 2, muteCount: 3, status: "active" });
    const targetSnapshot = structuredClone(target);
    const aliasSnapshot = structuredClone(alias);
    sumAccountRollups(target, alias);
    expect(target).toEqual(targetSnapshot);
    expect(alias).toEqual(aliasSnapshot);
  });

  test("BS-48 SUM and +1 are distinct operators: summing two rollups adds their totals, applying one action only +1s", () => {
    const target = mkRollup({ blockCount: 2, muteCount: 0, status: "active" });
    const alias = mkRollup({ blockCount: 3, muteCount: 0, status: "active" });
    const summed = sumAccountRollups(target, alias);
    expect(summed.blockCount).toBe(5); // SUM: 2 + 3

    const applied = applyAccountRollup(target, {
      handle: target.handle,
      idUnknown: target.idUnknown,
      kind: "block",
      at: target.lastActionAt + 1,
    });
    expect(applied.blockCount).toBe(3); // +1: 2 + 1, never a sum of the two rollups
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
  // in the Convex runtime, not here. The arithmetic itself is NOT reimplemented — this
  // calls the same applyAccountRollup/sumAccountRollups functions convex/blocked.ts
  // imports, so this fake exercises the real shared operators rather than a hand-mirrored
  // copy of them.
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
            } else {
              // The SUM operator: two distinct rows for the same person, folded into one.
              row = { ...sumAccountRollups(row, alias), xUserId: args.xUserId };
            }
          }
        }

        // The +1 operator: this action folded into the (possibly just-migrated) row.
        const rollup = applyAccountRollup(row, {
          handle: args.handle,
          idUnknown: args.idUnknown,
          xUserId: args.xUserId,
          kind: args.kind,
          at: args.at,
        });
        rows.set(args.xUserId, { ...rollup, xUserId: args.xUserId });
      },
      // Mirrors convex/blocked.ts recordActions: a batch is exactly the singles in order.
      recordActions(batch: RecordActionArgs[]): void {
        for (const args of batch) {
          this.recordAction(args);
        }
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

  // Contract guard for the cloud handler in convex/blocked.ts (which runs in the Convex
  // runtime and cannot be executed here): makeFakeCloud now drives the real
  // applyAccountRollup/sumAccountRollups operators convex/blocked.ts imports (see
  // docs/adr/0002-shared-ledger-algebra.md), so there is nothing left to keep "in
  // lockstep" — these pin the three operators that legitimately DIFFER and must not be
  // conflated: a same-account upsert adds +1, an aliasKey fold SUMs two distinct rows,
  // and (separately, on the pull side) foldAccountSnapshot takes the max.
  test("BS-33 recordAction is idempotent on clientActionId", () => {
    const cloud = makeFakeCloud();
    const args: RecordActionArgs = {
      xUserId: "1",
      handle: "x",
      idUnknown: false,
      kind: "block",
      at: 1,
      source: "reply-bar",
      clientActionId: "dup",
    };
    cloud.recordAction(args);
    cloud.recordAction(args);

    const rows = cloud.listBlocked();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.blockCount).toBe(1);
  });

  test("BS-34 a same-account upsert increments by +1 (never max)", () => {
    const cloud = makeFakeCloud();
    cloud.recordAction({
      xUserId: "1",
      handle: "x",
      idUnknown: false,
      kind: "block",
      at: 1,
      source: "reply-bar",
      clientActionId: "a1",
    });
    cloud.recordAction({
      xUserId: "1",
      handle: "x",
      idUnknown: false,
      kind: "block",
      at: 2,
      source: "reply-bar",
      clientActionId: "a2",
    });

    // Two blocks of the same id roll up to 2 — a max(1, 1) fold would wrongly read 1.
    expect(cloud.listBlocked()[0]!.blockCount).toBe(2);
  });

  test("BS-35 an aliasKey fold SUMs the legacy handle row into the numeric row", () => {
    const cloud = makeFakeCloud();
    const handleRow = (clientActionId: string, at: number): RecordActionArgs => ({
      xUserId: "@ghost",
      handle: "ghost",
      idUnknown: true,
      kind: "block",
      at,
      source: "reply-bar",
      clientActionId,
    });
    // Two blocks accrue under the handle-keyed row, one under the numeric row...
    cloud.recordAction(handleRow("h1", 1));
    cloud.recordAction(handleRow("h2", 2));
    cloud.recordAction({
      xUserId: "1",
      handle: "ghost",
      idUnknown: false,
      kind: "block",
      at: 3,
      source: "reply-bar",
      clientActionId: "i1",
    });
    // ...then an action carrying the alias folds the handle row in and adds its own +1.
    cloud.recordAction({
      xUserId: "1",
      handle: "ghost",
      idUnknown: false,
      kind: "block",
      at: 4,
      source: "reply-bar",
      clientActionId: "i2",
      aliasKey: "@ghost",
    });

    const rows = cloud.listBlocked();
    expect(rows).toHaveLength(1); // the @ghost row is consumed, not left as a duplicate
    // 1 (numeric) + 2 (summed alias) + 1 (this action) = 4 — a max fold would read 2.
    expect(rows[0]!.blockCount).toBe(4);
    expect(rows[0]!.idUnknown).toBe(false);
  });

  test("BS-36 a batched push lands exactly like the same singles, and a retried batch is idempotent", () => {
    const args = (clientActionId: string, at: number): RecordActionArgs => ({
      xUserId: "1",
      handle: "spammer",
      idUnknown: false,
      kind: "block",
      at,
      source: "reply-bar",
      clientActionId,
    });
    const batch = [args("a1", 1), args("a2", 2)];

    const single = makeFakeCloud();
    for (const item of batch) single.recordAction(item);

    const batched = makeFakeCloud();
    batched.recordActions(batch);
    expect(batched.listBlocked()).toEqual(single.listBlocked());

    // A network retry of the whole chunk re-sends every item; clientActionId dedups.
    batched.recordActions(batch);
    expect(batched.listBlocked()).toEqual(single.listBlocked());
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
