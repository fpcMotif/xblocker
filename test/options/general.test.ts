// Catalog: OG-* (General pane: switches, max-replies slider/number pair, live storage sync).
import { beforeEach, describe, expect, test } from "bun:test";

import { renderGeneralPane } from "../../entrypoints/options/panes/general.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

function switchInput(index: number): HTMLInputElement {
  const el = document.querySelectorAll<HTMLInputElement>(".xb-opt-switch")[index];
  if (!el) throw new Error(`switch ${index} not found`);
  return el;
}

function slider(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(".xb-opt-slider")!;
}

function numberInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(".xb-opt-number")!;
}

function toggle(index: number): void {
  const input = switchInput(index);
  input.checked = !input.checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Reads the persisted `settings.maxReplies`, narrowing the storage fake's
 *  untyped record instead of asserting its shape. */
function storedMaxReplies(): number {
  const settings = storageFake.data["settings"];
  if (typeof settings === "object" && settings !== null && "maxReplies" in settings) {
    const { maxReplies } = settings;
    if (typeof maxReplies === "number") return maxReplies;
  }
  throw new Error("settings.maxReplies missing or not a number");
}

/** Installs a fake chrome.storage.onChanged and returns its listener list plus a
 *  restore function; mirrors the pattern used across the popup/shell suites. */
function installFakeOnChanged(): {
  listeners: Array<(changes: Record<string, unknown>, area: string) => void>;
  restore: () => void;
} {
  type ChangeListener = (changes: Record<string, unknown>, area: string) => void;
  const listeners: ChangeListener[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install a runtime onChanged fake the static chrome typings don't model.
  const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
  const original = chromeStorage["onChanged"];
  chromeStorage["onChanged"] = {
    addListener: (fn: ChangeListener) => listeners.push(fn),
    removeListener: (fn: ChangeListener) => {
      const index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    },
  };
  return {
    listeners,
    restore: () => {
      chromeStorage["onChanged"] = original;
    },
  };
}

describe("General pane", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OG-02 renders default values with nothing stored", async () => {
    await renderGeneralPane(document.body);
    expect(document.querySelector("h1")?.textContent).toBe("General");
    expect([switchInput(0).checked, switchInput(1).checked, switchInput(2).checked]).toEqual([
      true,
      true,
      false,
    ]);
    expect(slider().value).toBe("50");
    expect(numberInput().value).toBe("50");
  });

  test("OG-03 renders stored values, clamping an out-of-range stored maxReplies", async () => {
    storageFake.data["settings"] = {
      protectWhitelist: false,
      confirmDestructiveActions: false,
      keyboardMode: true,
      maxReplies: 9999,
    };
    await renderGeneralPane(document.body);
    expect([switchInput(0).checked, switchInput(1).checked, switchInput(2).checked]).toEqual([
      false,
      false,
      true,
    ]);
    expect(slider().value).toBe("200");
    expect(numberInput().value).toBe("200");
  });

  test("OG-04 toggling each switch persists the full 4-key settings blob", async () => {
    await renderGeneralPane(document.body);

    toggle(0);
    expect(storageFake.data["settings"]).toEqual({
      protectWhitelist: false,
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 50,
    });

    toggle(1);
    expect(storageFake.data["settings"]).toEqual({
      protectWhitelist: false,
      confirmDestructiveActions: false,
      keyboardMode: false,
      maxReplies: 50,
    });

    toggle(2);
    expect(storageFake.data["settings"]).toEqual({
      protectWhitelist: false,
      confirmDestructiveActions: false,
      keyboardMode: true,
      maxReplies: 50,
    });
  });

  test("OG-05 dragging the slider commits a clamped value and syncs the number input", async () => {
    await renderGeneralPane(document.body);

    slider().value = "75";
    slider().dispatchEvent(new Event("input", { bubbles: true }));
    expect(numberInput().value).toBe("75");
    expect(storedMaxReplies()).toBe(75);

    slider().value = "500"; // out of the slider's own max, but clampMaxReplies still guards it
    slider().dispatchEvent(new Event("input", { bubbles: true }));
    expect(numberInput().value).toBe("200");
  });

  test("OG-06 typing in the number input commits a clamped value on change and syncs the slider", async () => {
    await renderGeneralPane(document.body);

    numberInput().value = "12";
    numberInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(slider().value).toBe("12");
    expect(storedMaxReplies()).toBe(12);

    numberInput().value = "-5";
    numberInput().dispatchEvent(new Event("change", { bubbles: true }));
    expect(slider().value).toBe("1");
    expect(storedMaxReplies()).toBe(1);
  });

  test("OG-07 an external settings change (from the popup) live-updates the switches and slider", async () => {
    const { listeners, restore } = installFakeOnChanged();
    try {
      await renderGeneralPane(document.body);
      expect(listeners).toHaveLength(1);

      for (const listener of listeners) {
        listener(
          {
            settings: {
              newValue: {
                protectWhitelist: false,
                confirmDestructiveActions: false,
                keyboardMode: true,
                maxReplies: 33,
              },
            },
          },
          "local",
        );
      }

      expect([switchInput(0).checked, switchInput(1).checked, switchInput(2).checked]).toEqual([
        false,
        false,
        true,
      ]);
      expect(slider().value).toBe("33");
      expect(numberInput().value).toBe("33");
    } finally {
      restore();
    }
  });

  test("OG-08 ignores onChanged events for a different storage area or a different key", async () => {
    const { listeners, restore } = installFakeOnChanged();
    try {
      await renderGeneralPane(document.body);

      for (const listener of listeners) {
        listener({ settings: { newValue: { protectWhitelist: false } } }, "sync");
        listener({ whitelist: { newValue: ["someone"] } }, "local");
      }

      expect(switchInput(0).checked).toBe(true); // unchanged by either irrelevant event
    } finally {
      restore();
    }
  });

  test("OG-09 destroy() unsubscribes; a later change is no longer reflected", async () => {
    const { listeners, restore } = installFakeOnChanged();
    try {
      const handle = await renderGeneralPane(document.body);
      expect(listeners).toHaveLength(1);

      handle.destroy();
      expect(listeners).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
