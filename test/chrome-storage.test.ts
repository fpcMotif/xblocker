// Catalog: CS-* (storageGet / storageSet / key constants).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  CLOUD_BACKUP_KEY,
  DOCK_POSITION_KEY,
  storageGet,
  storageGetStrict,
  storageRemove,
  storageRemoveStrict,
  storageSet,
  storageSetStrict,
  WHITELIST_KEY,
} from "../entrypoints/lib/chrome-storage.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

describe("storage key constants", () => {
  test("CS-01 name the keys existing callers already use", () => {
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
    storageFake.data[WHITELIST_KEY] = ["alice"];
    expect(await storageGet<string[]>(WHITELIST_KEY)).toEqual(["alice"]);
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

describe("storageGetStrict", () => {
  beforeEach(() => resetTestEnvironment());

  test("resolves stored and missing values", async () => {
    storageFake.data[WHITELIST_KEY] = ["alice"];
    expect(await storageGetStrict<string[]>(WHITELIST_KEY)).toEqual(["alice"]);
    expect(await storageGetStrict(CLOUD_BACKUP_KEY)).toBeUndefined();
  });

  test("rejects failed reads", async () => {
    storageFake.failNextGet = true;
    expect(storageGetStrict(WHITELIST_KEY)).rejects.toThrow("chrome.storage.local.get failed");
  });
});

describe("storageSet", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CS-06 persists the given items and resolves", async () => {
    await storageSet({ [WHITELIST_KEY]: ["alice"] });
    expect(storageFake.data[WHITELIST_KEY]).toEqual(["alice"]);
    expect(storageFake.setCalls).toEqual([{ [WHITELIST_KEY]: ["alice"] }]);
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

  test("CS-10 strict writes reject when Chrome reports persistence failure", async () => {
    storageFake.failNextSet = true;
    const message = await storageSetStrict({ [CLOUD_BACKUP_KEY]: false }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(message).toBe("storage write failed");
    expect(storageFake.data[CLOUD_BACKUP_KEY]).toBeUndefined();
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

  test("strict delete rejects and preserves the key on failure", async () => {
    storageFake.data[CLOUD_BACKUP_KEY] = true;
    storageFake.failNextRemove = true;
    expect(storageRemoveStrict(CLOUD_BACKUP_KEY)).rejects.toThrow("storage remove failed");
    expect(storageFake.data[CLOUD_BACKUP_KEY]).toBe(true);
  });
});
