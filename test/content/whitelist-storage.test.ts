// Catalog: WL-* (getWhitelist / isWhitelisted / addToWhitelist / removeFromWhitelist).
// saveWhitelist is module-private now; persistence is asserted through the
// public API plus storageFake.data/setCalls. Load the test-hooks helper first
// so __XB_TEST__ is set before any entrypoints module evaluates.
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import keeps __XB_TEST__ ordering correct.
import "../helpers/content-hooks.ts";

import { beforeEach, describe, expect, test } from "bun:test";

import {
  addToWhitelist,
  getWhitelist,
  isWhitelisted,
  removeFromWhitelist,
} from "../../entrypoints/content/actions.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

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
    // X handles are case-insensitive (XB-BUG-02 fixed).
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
    expect(storageFake.setCalls).toEqual([{ whitelist: ["frank"] }]);
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

  test("WL-11 normalizes input and rejects invalid handles (XB-BUG-03 fixed)", async () => {
    // Entries are stored normalized so they match the handle blockTweet
    // extracts from the DOM; invalid input never reaches storage.
    expect(await addToWhitelist("@frank")).toBe("added");
    expect(storageFake.data["whitelist"]).toEqual(["frank"]);

    expect(await addToWhitelist("not a handle")).toBe("invalid");
    expect(storageFake.data["whitelist"]).toEqual(["frank"]);
    expect(storageFake.getCalls).toHaveLength(1);
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
    expect(storageFake.setCalls).toEqual([
      { whitelist: ["first"] },
      { whitelist: ["first", "second"] },
    ]);
    expect(storageFake.data["whitelist"]).toEqual(["first", "second"]);
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
    expect(storageFake.setCalls).toEqual([{ whitelist: ["bob"] }]);
  });

  test("WL-14 removes every duplicate occurrence at once", async () => {
    // Duplicates can predate the XB-BUG-08 fix or come from other surfaces;
    // filter() drops them all in a single remove (same shape as popup
    // XB-BUG-05).
    storageFake.data["whitelist"] = ["alice", "bob", "alice"];
    await removeFromWhitelist("alice");
    expect(storageFake.data["whitelist"]).toEqual(["bob"]);
  });

  test("WL-15 removing an absent username rewrites the list unchanged", async () => {
    storageFake.data["whitelist"] = ["alice"];
    await removeFromWhitelist("nobody");
    expect(storageFake.data["whitelist"]).toEqual(["alice"]);
    expect(storageFake.setCalls).toHaveLength(1);
  });

  test("WL-19 removal matches handles case-insensitively", async () => {
    storageFake.data["whitelist"] = ["Alice", "bob"];
    await removeFromWhitelist("alice");
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
});
