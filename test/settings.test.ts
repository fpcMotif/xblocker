// Catalog: SET-* (lib/settings storage reader). The pure normalizer (normalizeSettings)
// is unit-tested by OG-01 in test/options/general.test.ts; these cases pin the storage
// layer readSettings adds on top of it, driven through the chrome.storage fake.
import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS, readSettings } from "../entrypoints/lib/settings.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

describe("readSettings", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("SET-01 returns the normalized defaults when nothing is stored", async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("SET-02 reads the stored blob, filling gaps from defaults and clamping maxReplies", async () => {
    storageFake.data["settings"] = { protectWhitelist: false, maxReplies: 9999 };
    expect(await readSettings()).toEqual({
      protectWhitelist: false,
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 200,
    });
  });
});
