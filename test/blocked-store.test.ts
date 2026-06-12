import { beforeEach, describe, expect, test } from "bun:test";

import {
  accountKeyFor,
  mergeBlockedAccount,
  summarizeAccounts,
} from "../entrypoints/lib/blocked-merge.ts";
import { createBlockedStore } from "../entrypoints/lib/blocked-store.ts";

let counter = 0;
const fixedId = () => `action-${++counter}`;

beforeEach(async () => {
  counter = 0;
  // Reset the shared in-memory storage area between tests.
  await chrome.storage.local.clear();
});

describe("mergeBlockedAccount (pure dedup logic)", () => {
  test("creates one record for a brand-new block", () => {
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

  test("blocking the same id twice keeps one record and bumps the count", () => {
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

  test("block then mute on the same id is one record with both rollups", () => {
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

  test("records which of your accounts performed each action", () => {
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

  test("unblock flips status to unblocked without dropping history", () => {
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

  test("learns a numeric id for a record first seen by handle only", () => {
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

  test("accountKeyFor uses the id when present and a lowercased handle otherwise", () => {
    expect(accountKeyFor({ xUserId: "111", handle: "Foo" })).toBe("111");
    expect(accountKeyFor({ handle: "@Foo" })).toBe("@foo");
  });
});

describe("summarizeAccounts", () => {
  test("counts active blocked and muted accounts", () => {
    const stats = summarizeAccounts([
      { status: "active", blockCount: 2, muteCount: 0 },
      { status: "active", blockCount: 0, muteCount: 1 },
      { status: "active", blockCount: 1, muteCount: 1 },
      { status: "unblocked", blockCount: 1, muteCount: 0 },
    ]);

    expect(stats.accounts).toBe(4);
    expect(stats.blocked).toBe(2);
    expect(stats.muted).toBe(2);
  });
});

describe("BlockedStore (through chrome.storage.local)", () => {
  test("records the same id twice as one account with two actions", async () => {
    const store = createBlockedStore();

    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "block", source: "popup", xUserId: "111" });

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].blockCount).toBe(2);
    expect(list[0].actions).toHaveLength(2);
  });

  test("block then mute on the same id is one account row", async () => {
    const store = createBlockedStore();

    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "mute", source: "reply-bar", xUserId: "111" });

    const account = await store.get("111");
    expect(account?.blockCount).toBe(1);
    expect(account?.muteCount).toBe(1);
  });

  test("hasActiveHandle finds a blocked account by screen name", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "Spammer", kind: "block", source: "reply-bar", xUserId: "111" });

    expect(await store.hasActiveHandle("spammer")).toBe(true);
    expect(await store.hasActiveHandle("@SPAMMER")).toBe(true);
    expect(await store.hasActiveHandle("someoneelse")).toBe(false);
  });

  test("hasActiveHandle ignores unblocked accounts", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "unblock", source: "popup", xUserId: "111" });

    expect(await store.hasActiveHandle("spammer")).toBe(false);
  });

  test("stats reflect recorded blocks and mutes", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "a", kind: "block", source: "reply-bar", xUserId: "1" });
    await store.record({ handle: "b", kind: "mute", source: "reply-bar", xUserId: "2" });

    const stats = await store.stats();
    expect(stats).toEqual({ accounts: 2, blocked: 1, muted: 1 });
  });

  test("queues actions in the outbox and clears them once synced", async () => {
    const store = createBlockedStore();
    await store.record({ handle: "spammer", kind: "block", source: "reply-bar", xUserId: "111" });
    await store.record({ handle: "spammer", kind: "mute", source: "reply-bar", xUserId: "111" });

    const pending = await store.pending();
    expect(pending).toHaveLength(2);
    expect(pending[0].xUserId).toBe("111");

    await store.markSynced([pending[0].action.actionId]);
    const after = await store.pending();
    expect(after).toHaveLength(1);
    expect(after[0].action.actionId).toBe(pending[1].action.actionId);
  });

  test("mergeRemote unions cloud accounts that are not present locally", async () => {
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
