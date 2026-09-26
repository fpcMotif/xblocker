// Catalog: WW-* (pure Convex wire-format mapping for the whitelist mirror:
// WhitelistOutboxItem -> upsertWhitelistEntries args). Mirrors cloud-wire.test.ts (CW-*).
import { describe, expect, test } from "bun:test";

import { outboxItemToUpsertArgs, whitelistOutboxToBatches } from "../whitelist-wire.ts";
import type { WhitelistOutboxItem } from "../../storage/whitelist-store.ts";

describe("outboxItemToUpsertArgs", () => {
  test("WW-01 maps an active queue entry to upsert args", () => {
    const item: WhitelistOutboxItem = { handle: "alice", status: "active", at: 5, actionId: "a1" };
    expect(outboxItemToUpsertArgs(item)).toEqual({
      handle: "alice",
      status: "active",
      updatedAt: 5,
      clientActionId: "a1",
    });
  });

  test("WW-02 maps a removal as a status flip, never a delete", () => {
    const item: WhitelistOutboxItem = { handle: "bob", status: "removed", at: 9, actionId: "a2" };
    const args = outboxItemToUpsertArgs(item);
    expect(args.status).toBe("removed");
    expect(args.updatedAt).toBe(9);
  });

  test("WW-03 lowercases the handle: the cloud row key is case-insensitive like X", () => {
    const item: WhitelistOutboxItem = { handle: "Alice", status: "active", at: 5, actionId: "a3" };
    expect(outboxItemToUpsertArgs(item).handle).toBe("alice");
  });
});

describe("whitelistOutboxToBatches", () => {
  const item = (actionId: string): WhitelistOutboxItem => ({
    handle: `user_${actionId}`,
    status: "active",
    at: 1,
    actionId,
  });

  test("WW-04 splits the outbox into chunks of at most `size`, preserving order", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const batches = whitelistOutboxToBatches(items, 2);

    expect(batches.map((batch) => batch.items.length)).toEqual([2, 2, 1]);
    expect(batches.map((batch) => batch.actionIds)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    // Each chunk's args are exactly the per-item mapping, in order.
    expect(batches[0]!.args).toEqual([
      outboxItemToUpsertArgs(items[0]!),
      outboxItemToUpsertArgs(items[1]!),
    ]);
    expect(batches.flatMap((batch) => batch.items)).toEqual(items);
  });

  test("WW-05 an empty outbox maps to no batches", () => {
    expect(whitelistOutboxToBatches([], 50)).toEqual([]);
  });

  test("WW-06 a degenerate chunk size clamps to 1 instead of looping forever", () => {
    const items = [item("a"), item("b")];
    expect(whitelistOutboxToBatches(items, 0).map((batch) => batch.actionIds)).toEqual([
      ["a"],
      ["b"],
    ]);
    expect(whitelistOutboxToBatches(items, -3)).toHaveLength(2);
    expect(whitelistOutboxToBatches(items, 1.9)).toHaveLength(2); // fraction truncates to 1
  });
});
