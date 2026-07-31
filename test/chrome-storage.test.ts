// Catalog: CS-* (storageGet / storageSet / key constants).
import { beforeEach, describe, expect, test } from "bun:test";

import {
  CLOUD_BACKUP_KEY,
  DOCK_POSITION_KEY,
  SETTINGS_KEY,
  storageGet,
  storageGetStrict,
  storageRemove,
  storageSet,
  WHITELIST_KEY,
} from "../entrypoints/lib/chrome-storage.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

describe("storage key constants", () => {
  test("CS-01 name the keys existing callers already use", () => {
    expect(SETTINGS_KEY).toBe("settings");
    expect(WHITELIST_KEY).toBe("whitelist");
    expect(CLOUD_BACKUP_KEY).toBe("cloudBackup");
    expect(DOCK_POSITION_KEY).toBe("dockPosition");
  });
});

describe("storageGet", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-02 resolves the stored value", async () => {
    storageFake.data[SETTINGS_KEY] = { maxReplies: 25 };
    expect(await storageGet<{ maxReplies: number }>(SETTINGS_KEY)).toEqual({ maxReplies: 25 });
  });

  test("CS-03 resolves undefined when the key was never stored", async () => {
    expect(await storageGet(WHITELIST_KEY)).toBeUndefined();
    expect(storageFake.getCalls).toEqual([WHITELIST_KEY]);
  });

  test("CS-04 resolves undefined when the underlying read fails", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    storageFake.failNextGet = true;
    expect(await storageGet(CLOUD_BACKUP_KEY)).toBeUndefined();
  });

  test("CS-05 resolves undefined when the callback has runtime.lastError", async () => {
    storageFake.data[DOCK_POSITION_KEY] = { x: 1, y: 2 };
    storageFake.lastErrorNextGet = true;
    expect(await storageGet(DOCK_POSITION_KEY)).toBeUndefined();
  });
});

describe("storageGetStrict", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-06 resolves a stored value", async () => {
    storageFake.data[SETTINGS_KEY] = { maxReplies: 25 };
    expect(await storageGetStrict<{ maxReplies: number }>(SETTINGS_KEY)).toEqual({
      maxReplies: 25,
    });
  });

  test("CS-07 resolves undefined only when the key is absent", async () => {
    expect(await storageGetStrict(WHITELIST_KEY)).toBeUndefined();
  });

  test("CS-08 rejects a callback-scoped runtime error", async () => {
    storageFake.lastErrorNextGet = true;
    await expect(storageGetStrict(CLOUD_BACKUP_KEY)).rejects.toThrow("storage get failed: fake get failure");
    expect(chrome.runtime.lastError).toBeUndefined();
  });

  test("CS-09 rejects an unusable callback result", async () => {
    storageFake.returnNoResultNextGet = true;
    await expect(storageGetStrict(CLOUD_BACKUP_KEY)).rejects.toThrow("storage get returned no result");
  });
});

describe("storageSet", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-10 persists the given items and resolves", async () => {
    await storageSet({ [SETTINGS_KEY]: { maxReplies: 10 } });
    expect(storageFake.data[SETTINGS_KEY]).toEqual({ maxReplies: 10 });
    expect(storageFake.setCalls).toEqual([{ [SETTINGS_KEY]: { maxReplies: 10 } }]);
  });

  test("CS-11 rejects a callback-scoped runtime error", async () => {
    storageFake.lastErrorNextSet = true;
    await expect(storageSet({ [WHITELIST_KEY]: ["frank"] })).rejects.toThrow(
      "storage set failed: fake set failure",
    );
    expect(storageFake.data[WHITELIST_KEY]).toBeUndefined();
    expect(chrome.runtime.lastError).toBeUndefined();
  });

  test("CS-12 rejects a synchronous storage throw", async () => {
    storageFake.throwNextSet = true;
    await expect(storageSet({ [WHITELIST_KEY]: ["frank"] })).rejects.toThrow(
      "fake set throw",
    );
  });

  test("CS-13 set-to-undefined does NOT clear a key (chrome drops undefined values)", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    await storageSet({ [CLOUD_BACKUP_KEY]: undefined });
    expect(storageFake.data[CLOUD_BACKUP_KEY]).toBe(true);
  });
});

describe("storageRemove", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-14 deletes the key outright", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    await storageRemove(CLOUD_BACKUP_KEY);
    expect(CLOUD_BACKUP_KEY in storageFake.data).toBe(false);
  });

  test("CS-15 rejects a callback-scoped runtime error", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    storageFake.lastErrorNextRemove = true;
    await expect(storageRemove(CLOUD_BACKUP_KEY)).rejects.toThrow(
      "storage remove failed: fake remove failure",
    );
    expect(storageFake.data[CLOUD_BACKUP_KEY]).toBe(true);
    expect(chrome.runtime.lastError).toBeUndefined();
  });

  test("CS-16 rejects a synchronous storage throw", async () => {
    storageFake.throwNextRemove = true;
    await expect(storageRemove(CLOUD_BACKUP_KEY)).rejects.toThrow("fake remove throw");
  });
});
