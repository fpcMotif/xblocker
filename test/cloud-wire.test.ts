// Catalog: CW-* (pure Convex wire-format mapping: OutboxItem -> recordAction args).
//
// Relocated verbatim from test/blocked-store.test.ts (see docs/adr/0003) now that the
// mapping itself lives in a pure lib/cloud-wire.ts with no chrome.* dependency.
import { describe, expect, test } from "bun:test";

import { outboxItemToRecordArgs, outboxToRecordBatches } from "../entrypoints/lib/cloud-wire.ts";
import type { OutboxItem } from "../entrypoints/lib/blocked-store.ts";

describe("outboxItemToRecordArgs (cloud key mapping)", () => {
  const baseAction = { actionId: "a1", kind: "block", at: 5, source: "reply-bar" } as const;

  test("CW-01 keys by the numeric id and omits aliasKey when id-first", () => {
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

  test("CW-02 keys by @handle and omits aliasKey when the id is still unknown", () => {
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

  test("CW-03 sends aliasKey once an id is learned for a handle-first account", () => {
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

  test("CW-04 passes through which of your accounts performed the action", () => {
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

describe("outboxToRecordBatches (batched cloud push mapping)", () => {
  const item = (actionId: string): OutboxItem => ({
    accountKey: actionId,
    xUserId: actionId,
    handle: `user_${actionId}`,
    idUnknown: false,
    action: { actionId, kind: "block", at: 1, source: "reply-bar" },
  });

  test("CW-05 splits the outbox into chunks of at most `size`, preserving order", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const batches = outboxToRecordBatches(items, 2);

    expect(batches.map((batch) => batch.items.length)).toEqual([2, 2, 1]);
    expect(batches.map((batch) => batch.actionIds)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    // Each chunk's args are exactly the per-item mapping, in order.
    expect(batches[0]!.args).toEqual([
      outboxItemToRecordArgs(items[0]!),
      outboxItemToRecordArgs(items[1]!),
    ]);
    expect(batches.flatMap((batch) => batch.items)).toEqual(items);
  });

  test("CW-06 an empty outbox maps to no batches", () => {
    expect(outboxToRecordBatches([], 50)).toEqual([]);
  });

  test("CW-07 a degenerate chunk size clamps to 1 instead of looping forever", () => {
    const items = [item("a"), item("b")];
    expect(outboxToRecordBatches(items, 0).map((batch) => batch.actionIds)).toEqual([["a"], ["b"]]);
    expect(outboxToRecordBatches(items, -3)).toHaveLength(2);
    expect(outboxToRecordBatches(items, 1.9)).toHaveLength(2); // fraction truncates to 1
  });
});
