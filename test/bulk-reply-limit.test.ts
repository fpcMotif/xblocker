import { beforeEach, describe, expect, test } from "bun:test";

import { bulkReplyLimit } from "../entrypoints/lib/bulk-reply-limit.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

beforeEach(() => {
  resetTestEnvironment();
});

describe("Bulk reply limit", () => {
  test("BL-01 defaults to 50 without creating storage", async () => {
    expect(await bulkReplyLimit.read()).toBe(50);
    expect(storageFake.data).toEqual({});
  });

  test("BL-02 reads legacy settings without mutating from a content context", async () => {
    storageFake.data["settings"] = { maxReplies: "75", keyboardMode: true };

    expect(await bulkReplyLimit.read()).toBe(75);
    expect(storageFake.data["bulkReplyLimit"]).toBeUndefined();
    expect(storageFake.data["settings"]).toEqual({ maxReplies: "75", keyboardMode: true });
  });

  test("BL-03 migrates and normalizes legacy settings once", async () => {
    storageFake.data["settings"] = { maxReplies: "75", keyboardMode: true };

    expect(await bulkReplyLimit.migrate()).toBe(75);
    expect(storageFake.data["bulkReplyLimit"]).toBe(75);
    expect("settings" in storageFake.data).toBe(false);
  });

  test("BL-04 the dedicated value wins and stale legacy settings are removed", async () => {
    storageFake.data["bulkReplyLimit"] = 80;
    storageFake.data["settings"] = { maxReplies: 25 };

    expect(await bulkReplyLimit.migrate()).toBe(80);
    expect("settings" in storageFake.data).toBe(false);
  });

  test("BL-05 malformed legacy data falls back to 50 and is retired", async () => {
    storageFake.data["settings"] = { maxReplies: "75 replies" };

    expect(await bulkReplyLimit.migrate()).toBe(50);
    expect(storageFake.data["bulkReplyLimit"]).toBe(50);
    expect("settings" in storageFake.data).toBe(false);
  });

  test("BL-06 set clamps numeric values and returns the active limit", async () => {
    expect(await bulkReplyLimit.set(999)).toBe(200);
    expect(storageFake.data["bulkReplyLimit"]).toBe(200);
    expect(await bulkReplyLimit.set(-4)).toBe(1);
    expect(storageFake.data["bulkReplyLimit"]).toBe(1);
  });

  test("BL-07 set rejects non-finite input without replacing the active limit", async () => {
    storageFake.data["bulkReplyLimit"] = 75;
    const message = await bulkReplyLimit.set(Number.NaN).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toBe("Bulk reply limit must be a finite number.");
    expect(storageFake.data["bulkReplyLimit"]).toBe(75);
  });

  test("BL-08 rejected persistence never reports an unsaved value", async () => {
    storageFake.data["bulkReplyLimit"] = 60;
    storageFake.failNextSet = true;
    const message = await bulkReplyLimit.set(75).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toBe("storage write failed");
    expect(await bulkReplyLimit.read()).toBe(60);
  });
});
