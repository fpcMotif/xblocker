// Catalog: OW-* (watchStorage: chrome.storage.onChanged subscribe/unsubscribe seam).
import { beforeEach, describe, expect, test } from "bun:test";

import { watchStorage } from "../../entrypoints/options/storage-watch.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("watchStorage", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OW-01 is an inert no-op when chrome.storage.onChanged is unavailable (test mock)", () => {
    const listener = () => {};
    const unsubscribe = watchStorage(listener);
    expect(() => unsubscribe()).not.toThrow();
  });

  test("OW-02 subscribes to onChanged and forwards changes/areaName verbatim", () => {
    type ChangeListener = (changes: Record<string, unknown>, area: string) => void;
    const listeners: ChangeListener[] = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install a runtime onChanged fake the static chrome typings don't model.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    chromeStorage["onChanged"] = {
      addListener: (fn: ChangeListener) => listeners.push(fn),
      removeListener: (fn: ChangeListener) => {
        const index = listeners.indexOf(fn);
        if (index !== -1) listeners.splice(index, 1);
      },
    };
    try {
      const seen: Array<{ changes: Record<string, unknown>; area: string }> = [];
      const unsubscribe = watchStorage((changes, area) => seen.push({ changes, area }));
      expect(listeners).toHaveLength(1);

      const change = { settings: { newValue: { a: 1 } } };
      for (const listener of listeners) listener(change, "local");
      expect(seen).toEqual([{ changes: change, area: "local" }]);

      unsubscribe();
      expect(listeners).toHaveLength(0);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
    }
  });
});
