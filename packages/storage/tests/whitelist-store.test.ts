// Catalog: WL-* (getWhitelist / isWhitelisted / addToWhitelist / removeFromWhitelist),
// mirroring test/content/whitelist-storage.test.ts's cases against the shared
// packages/storage/whitelist-store.ts module, plus WL-20/WL-21 for concurrent removes
// and a mixed add+remove race that the ported module must also serialize. WL-30+ cover
// the cloud-sync port (outbox enqueue, pending, markSynced, mergeRemote, backfill) and
// pin the pure whitelist-merge folds the Convex handler delegates to.
import { beforeEach, describe, expect, test } from "bun:test";

import {
  applyWhitelistUpsert,
  reconcileWhitelist,
  type RemoteWhitelistEntry,
  type WhitelistOutboxItem,
  type WhitelistUpsertInput,
} from "../whitelist-merge.ts";
import {
  addManyToWhitelist,
  addToWhitelist,
  backfillWhitelistOutbox,
  getWhitelist,
  isWhitelisted,
  markWhitelistSynced,
  mergeRemoteWhitelist,
  pendingWhitelistOutbox,
  removeFromWhitelist,
  WHITELIST_OUTBOX_STORAGE_KEY,
} from "../whitelist-store.ts";
import { settleMicrotasks } from "../../../test/helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../../../test/setup.ts";

/** The outbox entries a mutation queued, with the volatile fields (actionId, at)
 *  asserted only for presence. */
function queuedEntries(): Array<Partial<WhitelistOutboxItem>> {
  const stored = storageFake.data[WHITELIST_OUTBOX_STORAGE_KEY];
  const outbox: WhitelistOutboxItem[] = Array.isArray(stored) ? stored : [];
  return outbox.map((item) => {
    expect(typeof item.actionId).toBe("string");
    expect(item.actionId.length).toBeGreaterThan(0);
    expect(typeof item.at).toBe("number");
    return { handle: item.handle, status: item.status };
  });
}

/** Assert the one write a mutation made carried BOTH the list and the outbox (the
 *  same-set atomicity the self-healing argument depends on). */
function expectLastSetListAndOutbox(whitelist: string[]): void {
  const lastSet = storageFake.setCalls[storageFake.setCalls.length - 1]!;
  expect(lastSet["whitelist"]).toEqual(whitelist);
  expect(Array.isArray(lastSet[WHITELIST_OUTBOX_STORAGE_KEY])).toBe(true);
}

describe("getWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-01 resolves an empty array when nothing is stored", async () => {
    expect(await getWhitelist()).toEqual([]);
    expect(storageFake.getCalls).toEqual(["whitelist"]);
  });

  test("WL-02 resolves the stored whitelist verbatim", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    expect(await getWhitelist()).toEqual(["alice", "bob"]);
  });

  test("WL-03 coerces a non-array stored value to an empty array", async () => {
    storageFake.data["whitelist"] = "corrupted-string";
    expect(await getWhitelist()).toEqual([]);
  });

  test("WL-04 coerces a null stored value to an empty array", async () => {
    storageFake.data["whitelist"] = null;
    expect(await getWhitelist()).toEqual([]);
  });

  test("WL-05 resolves an empty array when the storage get fails", async () => {
    storageFake.failNextGet = true;
    expect(await getWhitelist()).toEqual([]);
  });
});

describe("isWhitelisted", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-06 resolves true for a stored username", async () => {
    storageFake.data["whitelist"] = ["alice"];
    expect(await isWhitelisted("alice")).toBe(true);
  });

  test("WL-07 resolves false when absent or empty; matching ignores case", async () => {
    expect(await isWhitelisted("alice")).toBe(false);

    storageFake.data["whitelist"] = ["alice"];
    expect(await isWhitelisted("bob")).toBe(false);
    // X handles are case-insensitive.
    expect(await isWhitelisted("Alice")).toBe(true);
  });
});

describe("addToWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test('WL-08 appends a new username, persists it, and resolves "added"', async () => {
    expect(await addToWhitelist("frank")).toBe("added");
    expect(storageFake.data["whitelist"]).toEqual(["frank"]);
    // The list and the queued sync event land in ONE storage.set.
    expectLastSetListAndOutbox(["frank"]);
    expect(queuedEntries()).toEqual([{ handle: "frank", status: "active" }]);
  });

  test('WL-09 resolves "exists" without rewriting an already-whitelisted username', async () => {
    storageFake.data["whitelist"] = ["grace"];
    expect(await addToWhitelist("grace")).toBe("exists");
    // The duplicate check ignores case and the leading @, like X handles do.
    expect(await addToWhitelist("@Grace")).toBe("exists");
    expect(storageFake.data["whitelist"]).toEqual(["grace"]);
    // No write should happen when the user is already present.
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-10 appends onto an existing whitelist preserving order", async () => {
    storageFake.data["whitelist"] = ["heidi"];
    expect(await addToWhitelist("ivan")).toBe("added");
    expect(storageFake.data["whitelist"]).toEqual(["heidi", "ivan"]);
  });

  test("WL-11 normalizes input and rejects invalid handles", async () => {
    // Entries are stored normalized so they match the handle blockTweet
    // extracts from the DOM; invalid input never reaches storage.
    expect(await addToWhitelist("@frank")).toBe("added");
    expect(storageFake.data["whitelist"]).toEqual(["frank"]);

    expect(await addToWhitelist("not a handle")).toBe("invalid");
    expect(storageFake.data["whitelist"]).toEqual(["frank"]);
    // The valid add reads the list AND the outbox; the invalid one reads nothing.
    expect(storageFake.getCalls).toHaveLength(2);
    expect(storageFake.setCalls).toHaveLength(1);
  });

  test("WL-12 serializes concurrent adds so no entry is lost (XB-BUG-08 fixed)", async () => {
    // Mutations run through a single promise chain: the second add does not
    // read until the first save lands, so last-write-wins clobbering is gone.
    storageFake.useManualDispatch();

    const first = addToWhitelist("first");
    const second = addToWhitelist("second");
    await settleMicrotasks();

    // Only the first mutation's read is in flight; the second is queued.
    expect(storageFake.getCalls).toHaveLength(1);

    for (let round = 0; round < 6; round++) {
      storageFake.flush();
      await settleMicrotasks();
    }

    expect(await first).toBe("added");
    expect(await second).toBe("added");
    expect(storageFake.setCalls.map((call) => call["whitelist"])).toEqual([
      ["first"],
      ["first", "second"],
    ]);
    expect(storageFake.data["whitelist"]).toEqual(["first", "second"]);
    expect(queuedEntries()).toEqual([
      { handle: "first", status: "active" },
      { handle: "second", status: "active" },
    ]);
  });
});

describe("removeFromWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-13 removes the username and persists the filtered list", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    await removeFromWhitelist("alice");
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
    expectLastSetListAndOutbox(["bob"]);
    // A removal is queued as a status flip so it can propagate to other devices.
    expect(queuedEntries()).toEqual([{ handle: "alice", status: "removed" }]);
  });

  test("WL-14 removes every duplicate occurrence at once", async () => {
    // Duplicates can predate the XB-BUG-08 fix or come from other surfaces;
    // filter() drops them all in a single remove.
    storageFake.data["whitelist"] = ["alice", "bob", "alice"];
    await removeFromWhitelist("alice");
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
    // Still a single queued removal for the handle, not one per duplicate.
    expect(queuedEntries()).toEqual([{ handle: "alice", status: "removed" }]);
  });

  test("WL-15 removing an absent username rewrites the list unchanged", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await removeFromWhitelist("nobody");
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(1);
    // Nothing matched, so no sync event is queued.
    expect(storageFake.data[WHITELIST_OUTBOX_STORAGE_KEY]).toBeUndefined();
  });

  test("WL-19 removal matches handles case-insensitively", async () => {
    storageFake.data["whitelist"] = ["Alice", "bob"];
    await removeFromWhitelist("alice");
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
    // The queued removal keeps the stored entry's casing; the wire mapping lowercases.
    expect(queuedEntries()).toEqual([{ handle: "Alice", status: "removed" }]);
  });

  test("WL-20 serializes concurrent removes so both entries are dropped", async () => {
    storageFake.data["whitelist"] = ["first", "second", "third"];
    storageFake.useManualDispatch();

    const removeFirst = removeFromWhitelist("first");
    const removeSecond = removeFromWhitelist("second");
    await settleMicrotasks();

    // Only the first mutation's read is in flight; the second is queued behind it.
    expect(storageFake.getCalls).toHaveLength(1);

    for (let round = 0; round < 6; round++) {
      storageFake.flush();
      await settleMicrotasks();
    }

    await removeFirst;
    await removeSecond;
    expect(storageFake.data["whitelist"]).toEqual(["third"]);
  });

  test("WL-21 serializes a concurrent add and remove in call order", async () => {
    storageFake.data["whitelist"] = ["alice"];
    storageFake.useManualDispatch();

    const adding = addToWhitelist("bob");
    const removing = removeFromWhitelist("alice");
    await settleMicrotasks();

    expect(storageFake.getCalls).toHaveLength(1);

    for (let round = 0; round < 6; round++) {
      storageFake.flush();
      await settleMicrotasks();
    }

    expect(await adding).toBe("added");
    await removing;
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
  });
});

describe("storage failure tolerance", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test('WL-16 addToWhitelist resolves "added" even when the write is dropped', async () => {
    // chrome.storage.set failures are invisible to the caller: the callback
    // still fires, so the promise resolves "added" with nothing persisted.
    storageFake.failNextSet = true;
    expect(await addToWhitelist("mallory")).toBe("added");
    expect(storageFake.data["whitelist"]).toBeUndefined();
  });

  test("WL-17 a failed read aborts addToWhitelist instead of clobbering entries", async () => {
    // A transient get failure used to read as an empty whitelist, so the next
    // save dropped every existing entry (XB-BUG-08 family). The mutation now
    // aborts the save and reports the failure.
    storageFake.data["whitelist"] = ["alice"];
    storageFake.failNextGet = true;
    expect(await addToWhitelist("bob")).toBe("error");
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-18 a failed read aborts removeFromWhitelist without rewriting", async () => {
    storageFake.data["whitelist"] = ["alice"];
    storageFake.failNextGet = true;
    await removeFromWhitelist("alice");
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-22 a failed mutation does not wedge the chain for later mutations", async () => {
    // Both mutations are enqueued before either settles, so the recovering one
    // only runs if the chain advances PAST the rejected one. This pins the
    // `whitelistMutationChain = run.catch(...)` recovery: with a plain
    // `whitelistMutationChain = run` the second add chains off a rejected
    // promise, its body is skipped, and "ok" is never written.
    // chrome.storage.local.get throws synchronously when the extension context
    // is invalidated; a one-shot throwing get reproduces that rejection.
    const originalGet = storageFake.get.bind(storageFake);
    storageFake.get = () => {
      storageFake.get = originalGet;
      throw new Error("Extension context invalidated.");
    };

    const failing = addToWhitelist("boom");
    const recovering = addToWhitelist("ok");

    let failingRejected = false;
    await failing.catch(() => {
      failingRejected = true;
    });
    expect(failingRejected).toBe(true);

    expect(await recovering).toBe("added");
    expect(storageFake.data["whitelist"]).toEqual(["ok"]);
  });
});

describe("addManyToWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-23 an empty batch reads once, writes nothing, and returns all-zero counts", async () => {
    storageFake.data["whitelist"] = ["alice"];
    expect(await addManyToWhitelist([])).toEqual({ added: 0, skipped: 0, invalid: 0 });
    expect(storageFake.getCalls).toHaveLength(1);
    expect(storageFake.setCalls).toHaveLength(0);
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
  });

  test("WL-24 a batch that's all duplicates (existing + within-batch) skips everything without writing", async () => {
    storageFake.data["whitelist"] = ["alice"];
    const result = await addManyToWhitelist(["Alice", "alice", "@ALICE"]);
    expect(result).toEqual({ added: 0, skipped: 3, invalid: 0 });
    expect(storageFake.setCalls).toHaveLength(0);
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
  });

  test("WL-25 a mixed batch reads once, adds new handles, dedupes case-insensitively, and counts invalid entries", async () => {
    storageFake.data["whitelist"] = ["alice"];
    const result = await addManyToWhitelist([
      "bob",
      "Alice",
      "not a handle",
      "bob",
      "@carol",
      "explore",
    ]);
    expect(result).toEqual({ added: 2, skipped: 2, invalid: 2 });
    // One read of the list, one of the outbox; one write carrying both.
    expect(storageFake.getCalls).toHaveLength(2);
    expectLastSetListAndOutbox(["alice", "bob", "carol"]);
    expect(storageFake.data["whitelist"]).toEqual(["alice", "bob", "carol"]);
    // Each added handle queues its own sync event, but all inside the single write —
    // a large import never pays a per-handle round trip.
    expect(queuedEntries()).toEqual([
      { handle: "bob", status: "active" },
      { handle: "carol", status: "active" },
    ]);
  });

  test("WL-26 a failed read aborts addManyToWhitelist instead of clobbering entries", async () => {
    storageFake.data["whitelist"] = ["alice"];
    storageFake.failNextGet = true;
    expect(await addManyToWhitelist(["bob"])).toEqual({ added: 0, skipped: 0, invalid: 0 });
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(0);
  });
});

describe("cloud-sync port: outbox queueing failures", () => {
  beforeEach(() => {
    resetTestEnvironment();
    storageFake.failGetKeys.add(WHITELIST_OUTBOX_STORAGE_KEY);
  });

  test('WL-27 a failed outbox read aborts addToWhitelist as "error" without writing', async () => {
    expect(await addToWhitelist("bob")).toBe("error");
    expect(storageFake.data["whitelist"]).toBeUndefined();
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-28 a failed outbox read aborts removeFromWhitelist without writing", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await removeFromWhitelist("alice");
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-29 a failed outbox read aborts addManyToWhitelist without writing", async () => {
    expect(await addManyToWhitelist(["bob"])).toEqual({ added: 0, skipped: 0, invalid: 0 });
    expect(storageFake.data["whitelist"]).toBeUndefined();
    expect(storageFake.setCalls).toHaveLength(0);
  });
});

describe("cloud-sync port: pending / markSynced", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-30 pending() reflects the queued changes and rejects on a failed read", async () => {
    expect(await pendingWhitelistOutbox()).toEqual([]);

    await addToWhitelist("alice");
    const pending = await pendingWhitelistOutbox();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ handle: "alice", status: "active" });

    storageFake.failNextGet = true;
    const failedRead = pendingWhitelistOutbox();
    expect(failedRead).rejects.toThrow(/outbox/);
    await failedRead.catch(() => undefined);
  });

  test("WL-30b a queued change gets a non-crypto action id when crypto.randomUUID is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    // Force genId down its non-crypto fallback branch.
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      await addToWhitelist("alice");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
    }
    const [queued] = await pendingWhitelistOutbox();
    expect(queued?.actionId).toBeTruthy();
  });

  test("WL-31 markSynced drains only the accepted action ids", async () => {
    await addToWhitelist("alice");
    await addToWhitelist("bob");
    const [first, second] = await pendingWhitelistOutbox();

    await markWhitelistSynced([first!.actionId]);
    expect((await pendingWhitelistOutbox()).map((item) => item.actionId)).toEqual([
      second!.actionId,
    ]);

    // Draining with an empty id set never touches storage.
    const getCalls = storageFake.getCalls.length;
    await markWhitelistSynced([]);
    expect(storageFake.getCalls.length).toBe(getCalls);
  });

  test("WL-31b a failed outbox read makes markSynced a no-op, keeping entries queued", async () => {
    await addToWhitelist("alice");
    const [first] = await pendingWhitelistOutbox();

    storageFake.failNextGet = true;
    await markWhitelistSynced([first!.actionId]);
    expect(await pendingWhitelistOutbox()).toHaveLength(1);
  });
});

describe("cloud-sync port: mergeRemote", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  const remoteRow = (
    handle: string,
    status: "active" | "removed",
    updatedAt: number,
  ): RemoteWhitelistEntry => ({ handle, status, updatedAt });

  test("WL-32 unions in remote active rows not present locally (restore on a new device)", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await mergeRemoteWhitelist([
      remoteRow("bob", "active", 100),
      remoteRow("alice", "active", 100),
    ]);
    expect(storageFake.data["whitelist"]).toEqual(["alice", "bob"]);
  });

  test("WL-33 drops local entries whose remote row is removed (a removal propagates)", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    await mergeRemoteWhitelist([remoteRow("alice", "removed", 100)]);
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
  });

  test("WL-34 a still-pending local change wins over an older-or-equal remote row", async () => {
    // Local remove queued NOW; the remote row still says active from an older sync.
    storageFake.data["whitelistOutbox"] = [
      { handle: "alice", status: "removed", at: 200, actionId: "w1" },
    ] satisfies WhitelistOutboxItem[];
    storageFake.data["whitelist"] = ["bob"];

    await mergeRemoteWhitelist([remoteRow("alice", "active", 200)]);
    // The pending removal is newer-or-equal: the remote row must NOT resurrect alice.
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
    expect(await pendingWhitelistOutbox()).toHaveLength(1);

    // A strictly NEWER remote decision does win over the pending local one.
    await mergeRemoteWhitelist([remoteRow("alice", "active", 201)]);
    expect(storageFake.data["whitelist"]).toEqual(["bob", "alice"]);
  });

  test("WL-35 no write when the merge changes nothing; an empty pull reads nothing", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await mergeRemoteWhitelist([remoteRow("alice", "active", 100)]);
    expect(storageFake.setCalls).toHaveLength(0);

    const getCalls = storageFake.getCalls.length;
    await mergeRemoteWhitelist([]);
    expect(storageFake.getCalls.length).toBe(getCalls);
  });

  test("WL-36 a failed read aborts the merge instead of clobbering the list", async () => {
    storageFake.data["whitelist"] = ["alice"];
    storageFake.failNextGet = true;
    await mergeRemoteWhitelist([remoteRow("bob", "active", 100)]);
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(0);

    // Same for the outbox read: the merge needs pending state to protect local changes.
    storageFake.failGetKeys.add(WHITELIST_OUTBOX_STORAGE_KEY);
    await mergeRemoteWhitelist([remoteRow("bob", "active", 100)]);
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
  });

  test("WL-37 a synced handle still matches case-insensitively after the round trip", async () => {
    // The cloud keys rows by lowercased handle; the merged local entry must still
    // match the way local lookups do.
    await mergeRemoteWhitelist([remoteRow("alice", "active", 100)]);
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(await isWhitelisted("Alice")).toBe(true);
    expect(await isWhitelisted("ALICE")).toBe(true);
  });
});

describe("cloud-sync port: first-sync backfill", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-38 queues every existing local handle as a pending active change", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    await backfillWhitelistOutbox();
    const pending = await pendingWhitelistOutbox();
    expect(pending.map((item) => ({ handle: item.handle, status: item.status }))).toEqual([
      { handle: "alice", status: "active" },
      { handle: "bob", status: "active" },
    ]);
    // The list itself is untouched.
    expect(storageFake.data["whitelist"]).toEqual(["alice", "bob"]);
  });

  test("WL-39 is idempotent: already-queued handles are not queued twice", async () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    await addToWhitelist("carol"); // carol is already pending
    await backfillWhitelistOutbox();
    await backfillWhitelistOutbox();
    const pending = await pendingWhitelistOutbox();
    expect(pending.map((item) => item.handle)).toEqual(["carol", "alice", "bob"]);
  });

  test("WL-39b an empty whitelist backfills nothing and writes nothing", async () => {
    await backfillWhitelistOutbox();
    expect(storageFake.data[WHITELIST_OUTBOX_STORAGE_KEY]).toBeUndefined();
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-39c failed reads abort the backfill without writing", async () => {
    storageFake.data["whitelist"] = ["alice"];
    storageFake.failNextGet = true;
    await backfillWhitelistOutbox();
    expect(storageFake.data[WHITELIST_OUTBOX_STORAGE_KEY]).toBeUndefined();

    storageFake.failGetKeys.add(WHITELIST_OUTBOX_STORAGE_KEY);
    await backfillWhitelistOutbox();
    expect(storageFake.data[WHITELIST_OUTBOX_STORAGE_KEY]).toBeUndefined();
  });
});

describe("applyWhitelistUpsert (the cloud last-write-wins fold)", () => {
  const input = (overrides: Partial<WhitelistUpsertInput> = {}): WhitelistUpsertInput => ({
    handle: "alice",
    status: "active",
    updatedAt: 100,
    clientActionId: "a1",
    ...overrides,
  });

  test("WL-40 inserts when no row exists", () => {
    expect(applyWhitelistUpsert(undefined, input())).toEqual({
      handle: "alice",
      status: "active",
      updatedAt: 100,
      lastClientActionId: "a1",
    });
  });

  test("WL-41 a replayed clientActionId is a no-op (retried pushes never double-apply)", () => {
    const existing = applyWhitelistUpsert(undefined, input());
    expect(applyWhitelistUpsert(existing, input())).toBeUndefined();
    // Even with a NEWER timestamp: the action id already says this exact change landed.
    expect(applyWhitelistUpsert(existing, input({ updatedAt: 200 }))).toBeUndefined();
  });

  test("WL-42 an older updatedAt loses to the row (another device decided later)", () => {
    const existing = applyWhitelistUpsert(undefined, input({ updatedAt: 100 }));
    expect(
      applyWhitelistUpsert(
        existing,
        input({ status: "removed", updatedAt: 50, clientActionId: "a2" }),
      ),
    ).toBeUndefined();
  });

  test("WL-43 a newer upsert flips status and bumps updatedAt; a tie applies the arrival", () => {
    const existing = applyWhitelistUpsert(undefined, input());
    expect(
      applyWhitelistUpsert(
        existing,
        input({ status: "removed", updatedAt: 150, clientActionId: "a2" }),
      ),
    ).toMatchObject({ status: "removed", updatedAt: 150, lastClientActionId: "a2" });
    // Same-ms disagreement converges on whichever push lands last.
    expect(
      applyWhitelistUpsert(
        existing,
        input({ status: "removed", updatedAt: 100, clientActionId: "a3" }),
      ),
    ).toMatchObject({ status: "removed", updatedAt: 100 });
  });
});

describe("reconcileWhitelist (pure pull reconcile)", () => {
  test("WL-45 keeps local casing and order; remote-only actives append in remote order", () => {
    const next = reconcileWhitelist(
      ["Alice", "bob"],
      [
        { handle: "ALICE", status: "active", updatedAt: 100 },
        { handle: "carol", status: "active", updatedAt: 90 },
        { handle: "dave", status: "active", updatedAt: 80 },
      ],
      [],
    );
    expect(next).toEqual(["Alice", "bob", "carol", "dave"]);
  });

  test("WL-46 removed rows drop matching local entries; absent handles are ignored", () => {
    const next = reconcileWhitelist(
      ["alice", "bob"],
      [
        { handle: "Alice", status: "removed", updatedAt: 100 },
        { handle: "nobody", status: "removed", updatedAt: 100 },
      ],
      [],
    );
    expect(next).toEqual(["bob"]);
  });

  test("WL-47 pending local changes win ties and newer; older pending loses", () => {
    const pending = (handle: string, at: number): WhitelistOutboxItem => ({
      handle,
      status: "removed",
      at,
      actionId: `${handle}-${at}`,
    });
    // Pending remove at 100 vs remote active at 100: pending wins the tie (it still
    // has to push, and the cloud applies >=).
    expect(
      reconcileWhitelist(
        ["bob"],
        [{ handle: "alice", status: "active", updatedAt: 100 }],
        [pending("alice", 100)],
      ),
    ).toEqual(["bob"]);
    // Pending remove at 100 vs remote active at 101: the newer remote decision wins.
    expect(
      reconcileWhitelist(
        ["bob"],
        [{ handle: "alice", status: "active", updatedAt: 101 }],
        [pending("alice", 100)],
      ),
    ).toEqual(["bob", "alice"]);
    // Multiple pending entries for one handle: the latest timestamp is what competes.
    expect(
      reconcileWhitelist(
        [],
        [{ handle: "alice", status: "removed", updatedAt: 100 }],
        [pending("alice", 50), { handle: "alice", status: "active", at: 150, actionId: "a2" }],
      ),
    ).toEqual([]);
  });
});

describe("fake-cloud round trip (the Convex handler's fold, pinned locally)", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  /** A fake cloud built on the SAME fold convex/whitelist.ts delegates to, mirroring
   *  makeFakeCloud in blocked-store.test.ts (ADR-0002 discipline). */
  function makeFakeCloud() {
    const rows = new Map<
      string,
      {
        handle: string;
        status: "active" | "removed";
        updatedAt: number;
        lastClientActionId?: string;
      }
    >();
    return {
      upsert(items: WhitelistOutboxItem[]): string[] {
        for (const item of items) {
          const key = item.handle.toLowerCase();
          const folded = applyWhitelistUpsert(rows.get(key), {
            handle: key,
            status: item.status,
            updatedAt: item.at,
            clientActionId: item.actionId,
          });
          if (folded) rows.set(key, folded);
        }
        return items.map((item) => item.actionId);
      },
      list(): RemoteWhitelistEntry[] {
        return Array.from(rows.values()).map((row) => ({
          handle: row.handle,
          status: row.status,
          updatedAt: row.updatedAt,
        }));
      },
    };
  }

  test("WL-50 whitelist restores on a fresh device, and a later removal propagates", async () => {
    const cloud = makeFakeCloud();

    // Device A: build a whitelist and push it.
    await addToWhitelist("alice");
    await addToWhitelist("bob");
    const accepted = cloud.upsert(await pendingWhitelistOutbox());
    await markWhitelistSynced(accepted);
    expect(await pendingWhitelistOutbox()).toEqual([]);

    // Device B (fresh profile): the pull restores the whitelist.
    storageFake.data["whitelist"] = [];
    await mergeRemoteWhitelist(cloud.list());
    expect(await getWhitelist()).toEqual(["alice", "bob"]);

    // Device B removes alice and pushes; the cloud row flips, it is never deleted.
    await removeFromWhitelist("alice");
    const removalAccepted = cloud.upsert(await pendingWhitelistOutbox());
    await markWhitelistSynced(removalAccepted);
    expect(await pendingWhitelistOutbox()).toEqual([]);
    expect(cloud.list().find((row) => row.handle === "alice")).toMatchObject({
      status: "removed",
      updatedAt: expect.any(Number),
    });

    // Device A pulls: its local alice disappears too.
    storageFake.data["whitelist"] = ["alice", "bob"];
    storageFake.data[WHITELIST_OUTBOX_STORAGE_KEY] = [];
    await mergeRemoteWhitelist(cloud.list());
    expect(await getWhitelist()).toEqual(["bob"]);
  });
});
