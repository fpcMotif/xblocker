// Catalog: MR-* (Bulk reply limit integration with block/mute runs).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hooks, installFetchStub, populateTweetPage } from "../helpers/content-hooks.ts";
import { installImmediateTimers } from "../helpers/timers.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

describe("Bulk reply limit", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
    setWindowLocation("https://x.com/author/status/123456789");
    timers = installImmediateTimers();
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
    timers?.uninstall();
    timers = null;
  });

  test("MR-01 defaults to 50 replies per run when no setting is stored", async () => {
    expect(await hooks.getBulkReplyLimit()).toBe(50);
  });

  test("MR-02 defaults to 50 when the dedicated value is malformed", async () => {
    storageFake.data["bulkReplyLimit"] = "bad";

    expect(await hooks.getBulkReplyLimit()).toBe(50);
  });

  test("MR-04 fails closed when storage cannot be read", async () => {
    storageFake.data["bulkReplyLimit"] = 7;
    storageFake.failNextGet = true;

    expect(hooks.getBulkReplyLimit()).rejects.toThrow("chrome.storage.local.get failed");
  });

  test("MR-05 uses the stored max replies value", async () => {
    storageFake.data["bulkReplyLimit"] = 7;

    expect(await hooks.getBulkReplyLimit()).toBe(7);
  });

  test("MR-06 truncates fractional values", async () => {
    storageFake.data["bulkReplyLimit"] = 7.9;

    expect(await hooks.getBulkReplyLimit()).toBe(7);
  });

  test("MR-07 clamps values above the 200 cap", async () => {
    storageFake.data["bulkReplyLimit"] = 999;

    expect(await hooks.getBulkReplyLimit()).toBe(200);
  });

  test("MR-08 clamps zero and negative values up to 1", async () => {
    storageFake.data["bulkReplyLimit"] = 0;
    expect(await hooks.getBulkReplyLimit()).toBe(1);

    storageFake.data["bulkReplyLimit"] = -5;
    expect(await hooks.getBulkReplyLimit()).toBe(1);
  });

  test("MR-09 falls back to 50 for non-finite or non-numeric values", async () => {
    storageFake.data["bulkReplyLimit"] = Number.POSITIVE_INFINITY;
    expect(await hooks.getBulkReplyLimit()).toBe(50);

    storageFake.data["bulkReplyLimit"] = Number.NaN;
    expect(await hooks.getBulkReplyLimit()).toBe(50);

    storageFake.data["bulkReplyLimit"] = true;
    expect(await hooks.getBulkReplyLimit()).toBe(50);

    storageFake.data["bulkReplyLimit"] = null;
    expect(await hooks.getBulkReplyLimit()).toBe(50);
  });

  test("MR-10 parses numeric strings and clamps them like numbers", async () => {
    storageFake.data["bulkReplyLimit"] = "12";
    expect(await hooks.getBulkReplyLimit()).toBe(12);

    storageFake.data["bulkReplyLimit"] = "999";
    expect(await hooks.getBulkReplyLimit()).toBe(200);

    storageFake.data["bulkReplyLimit"] = "0";
    expect(await hooks.getBulkReplyLimit()).toBe(1);

    storageFake.data["bulkReplyLimit"] = "not-a-number";
    expect(await hooks.getBulkReplyLimit()).toBe(50);
  });

  test("MR-11 blocks only up to the configured max replies", async () => {
    storageFake.data["bulkReplyLimit"] = 2;
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_user_1", "reply_user_2", "reply_user_3", "reply_user_4"]);
    const progress: Array<{ done: number; total: number }> = [];

    const summary = await hooks.blockReplies((update) => progress.push(update));

    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
    expect(fetchStub.calls.map((call) => call.init?.body)).toEqual([
      "screen_name=reply_user_1",
      "screen_name=reply_user_2",
    ]);
    for (const call of fetchStub.calls) {
      expect(call.url).toBe("https://api.x.com/1.1/blocks/create.json");
    }
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  test("MR-12 mutes only up to the configured max replies", async () => {
    storageFake.data["bulkReplyLimit"] = 3;
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage([
      "reply_user_1",
      "reply_user_2",
      "reply_user_3",
      "reply_user_4",
      "reply_user_5",
    ]);

    const summary = await hooks.muteReplies();

    expect(summary).toEqual({ acted: 3, skipped: 0, failed: 0 });
    expect(fetchStub.calls.map((call) => call.init?.body)).toEqual([
      "screen_name=reply_user_1",
      "screen_name=reply_user_2",
      "screen_name=reply_user_3",
    ]);
    for (const call of fetchStub.calls) {
      expect(call.url).toBe("https://api.x.com/1.1/mutes/users/create.json");
    }
  });

  test("MR-13 processes every reply when fewer exist than the limit", async () => {
    storageFake.data["bulkReplyLimit"] = 50;
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_user_1", "reply_user_2"]);

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
    expect(fetchStub.calls).toHaveLength(2);
  });
});
