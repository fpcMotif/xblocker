// Catalog: SET-* (packages/storage/settings: the pure normalizer normalizeSettings, and the storage
// reader readSettings built on top of it). Used to be split — the normalizer's unit
// tests lived as OG-01 in test/options/general.test.ts — but a lib-level module should
// be tested at the lib level, so they moved here; the General pane suite now only tests
// pane behavior.
import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_SETTINGS, normalizeSettings, readSettings } from "../settings.ts";
import { resetTestEnvironment, storageFake } from "../../../test/setup.ts";

describe("normalizeSettings", () => {
  test("SET-01 top-level garbage (string, null, undefined) normalizes to the defaults", () => {
    expect(normalizeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test("SET-02 a partial blob merges onto the defaults", () => {
    expect(normalizeSettings({ protectWhitelist: false, maxReplies: 12 })).toEqual({
      protectWhitelist: false,
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 12,
    });
  });

  test("SET-03 maxReplies clamps out-of-range values and defaults on non-numeric input", () => {
    expect(normalizeSettings({ maxReplies: 99999 }).maxReplies).toBe(200);
    expect(normalizeSettings({ maxReplies: "banana" }).maxReplies).toBe(50);
    expect(normalizeSettings({ maxReplies: null }).maxReplies).toBe(50);
  });

  test("SET-04 per-field garbage falls back to that field's default; valid false values are kept", () => {
    expect(normalizeSettings({ protectWhitelist: 0 }).protectWhitelist).toBe(true);
    expect(normalizeSettings({ confirmDestructiveActions: "no" }).confirmDestructiveActions).toBe(
      true,
    );
    expect(normalizeSettings({ keyboardMode: 1 }).keyboardMode).toBe(false);

    // Valid `false` values must survive, not get coerced back to the (also-boolean) default.
    expect(normalizeSettings({ protectWhitelist: false }).protectWhitelist).toBe(false);
    expect(normalizeSettings({ confirmDestructiveActions: false }).confirmDestructiveActions).toBe(
      false,
    );
    expect(normalizeSettings({ keyboardMode: false }).keyboardMode).toBe(false);
  });

  test("SET-05 strips unknown keys instead of persisting them back", () => {
    const result = normalizeSettings({ evil: 1 });
    expect("evil" in result).toBe(false);
    expect(Object.keys(result).toSorted()).toEqual([
      "confirmDestructiveActions",
      "keyboardMode",
      "maxReplies",
      "protectWhitelist",
    ]);
  });
});

describe("readSettings", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("SET-06 returns the normalized defaults when nothing is stored", async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("SET-07 reads the stored blob, filling gaps from defaults and clamping maxReplies", async () => {
    storageFake.data["settings"] = { protectWhitelist: false, maxReplies: 9999 };
    expect(await readSettings()).toEqual({
      protectWhitelist: false,
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 200,
    });
  });
});
