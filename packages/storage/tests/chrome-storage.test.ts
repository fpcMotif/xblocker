// Catalog: CS-* (storageGet / storageSet / key constants).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  CLOUD_BACKUP_KEY,
  DOCK_POSITION_KEY,
  SETTINGS_KEY,
  storageGet,
  storageRemove,
  storageSet,
  WHITELIST_KEY,
} from "../chrome-storage.ts";
import { resetTestEnvironment, storageFake } from "../../../test/setup.ts";

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

  describe("with chrome.runtime.lastError set", () => {
    // chrome.runtime.lastError is declared `const` in @types/chrome (it's normally
    // stamped by the browser, never assigned by extension code), so poking it here
    // needs a narrow escape hatch from that read-only typing.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- lastError is declared read-only in @types/chrome, so mutating it needs this narrow escape hatch.
    const runtime = chrome.runtime as unknown as {
      lastError: chrome.runtime.LastError | undefined;
    };

    afterEach(() => {
      runtime.lastError = undefined;
    });

    test("CS-05 resolves undefined even though a value is stored", async () => {
      storageFake.data[DOCK_POSITION_KEY] = { x: 1, y: 2 };
      runtime.lastError = { message: "boom" };
      expect(await storageGet(DOCK_POSITION_KEY)).toBeUndefined();
    });
  });
});

describe("storageSet", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-06 persists the given items and resolves", async () => {
    await storageSet({ [SETTINGS_KEY]: { maxReplies: 10 } });
    expect(storageFake.data[SETTINGS_KEY]).toEqual({ maxReplies: 10 });
    expect(storageFake.setCalls).toEqual([{ [SETTINGS_KEY]: { maxReplies: 10 } }]);
  });

  test("CS-07 resolves even when the underlying write fails", async () => {
    storageFake.failNextSet = true;
    await storageSet({ [WHITELIST_KEY]: ["frank"] });
    expect(storageFake.data[WHITELIST_KEY]).toBeUndefined();
  });

  test("CS-08 set-to-undefined does NOT clear a key (chrome drops undefined values)", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    await storageSet({ [CLOUD_BACKUP_KEY]: undefined });
    expect(storageFake.data[CLOUD_BACKUP_KEY]).toBe(true);
  });
});

describe("storageRemove", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-09 deletes the key outright", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    await storageRemove(CLOUD_BACKUP_KEY);
    expect(CLOUD_BACKUP_KEY in storageFake.data).toBe(false);
  });
});
