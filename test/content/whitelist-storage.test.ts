// Catalog: WL-* (getWhitelist / saveWhitelist / addToWhitelist storage logic).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hooks } from "../helpers/content-hooks.ts";
import { installImmediateTimers } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

describe("getWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-01 yields an empty array when nothing is stored", () => {
    let received: string[] | null = null;
    hooks.getWhitelist((whitelist) => {
      received = whitelist;
    });
    expect(received).toEqual([]);
  });

  test("WL-02 returns the stored whitelist verbatim", () => {
    storageFake.data["whitelist"] = ["alice", "bob"];
    let received: string[] | null = null;
    hooks.getWhitelist((whitelist) => {
      received = whitelist;
    });
    expect(received).toEqual(["alice", "bob"]);
  });

  test("WL-03 coerces a non-array stored value to an empty array", () => {
    storageFake.data["whitelist"] = "corrupted-string";
    let received: string[] | null = null;
    hooks.getWhitelist((whitelist) => {
      received = whitelist;
    });
    expect(received).toEqual([]);
  });

  test("WL-04 coerces a null stored value to an empty array", () => {
    storageFake.data["whitelist"] = null;
    let received: string[] | null = null;
    hooks.getWhitelist((whitelist) => {
      received = whitelist;
    });
    expect(received).toEqual([]);
  });

  test("WL-05 survives a storage get failure (callback gets no items)", () => {
    storageFake.failNextGet = true;
    let received: string[] | null = null;
    expect(() => {
      hooks.getWhitelist((whitelist) => {
        received = whitelist;
      });
    }).not.toThrow();
    expect(received).toEqual([]);
  });
});

describe("saveWhitelist", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("WL-06 persists the array to chrome.storage", () => {
    hooks.saveWhitelist(["carol"]);
    expect(storageFake.data["whitelist"]).toEqual(["carol"]);
    expect(storageFake.setCalls).toHaveLength(1);
  });

  test("WL-07 a later getWhitelist observes a previous saveWhitelist", () => {
    hooks.saveWhitelist(["dave", "erin"]);
    let received: string[] | null = null;
    hooks.getWhitelist((whitelist) => {
      received = whitelist;
    });
    expect(received).toEqual(["dave", "erin"]);
  });
});

describe("addToWhitelist", () => {
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    timers = installImmediateTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("WL-08 appends a new username and persists it", () => {
    hooks.addToWhitelist("frank");
    expect(storageFake.data["whitelist"]).toEqual(["frank"]);
  });

  test("WL-09 does not duplicate an already-whitelisted username", () => {
    storageFake.data["whitelist"] = ["grace"];
    hooks.addToWhitelist("grace");
    expect(storageFake.data["whitelist"]).toEqual(["grace"]);
    // No write should happen when the user is already present.
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("WL-10 appends onto an existing whitelist preserving order", () => {
    storageFake.data["whitelist"] = ["heidi"];
    hooks.addToWhitelist("ivan");
    expect(storageFake.data["whitelist"]).toEqual(["heidi", "ivan"]);
  });

  test("WL-11 BUG XB-BUG-03: stores raw input without normalization", () => {
    // addToWhitelist (content modal path) does not normalize, so an @-prefixed
    // or invalid handle is stored as-is. Because blockTweet compares against
    // the normalized handle from the DOM, the stored "@frank" can never match
    // the extracted "frank" — a silently ineffective whitelist entry.
    hooks.addToWhitelist("@frank");
    expect(storageFake.data["whitelist"]).toEqual(["@frank"]);
  });

  test("WL-12 BUG XB-BUG-08: concurrent adds race and lose an entry", () => {
    // getWhitelist -> mutate -> saveWhitelist is a read-modify-write with no
    // locking. Under manual dispatch both reads see the empty list, so the
    // second save clobbers the first. Last-write-wins drops "first".
    storageFake.useManualDispatch();

    hooks.addToWhitelist("first");
    hooks.addToWhitelist("second");
    storageFake.flush();

    expect(storageFake.data["whitelist"]).toEqual(["second"]);
  });
});
