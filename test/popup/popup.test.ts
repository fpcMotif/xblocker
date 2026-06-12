// Catalog: PU-* (renderPopup, whitelist form, settings toggles, normalizeUsername).
import { beforeEach, describe, expect, test } from "bun:test";

import { renderPopup } from "../../entrypoints/popup/main.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

function seedState(overrides: {
  whitelist?: string[];
  settings?: Partial<{
    confirmDestructiveActions: boolean;
    keyboardMode: boolean;
    protectWhitelist: boolean;
  }>;
}): void {
  if (overrides.whitelist) storageFake.data["whitelist"] = overrides.whitelist;
  if (overrides.settings) storageFake.data["settings"] = overrides.settings;
}

describe("renderPopup structure", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PU-01 renders the shell: brand, status, whitelist input, settings", async () => {
    await renderPopup(document.body);
    const popup = document.querySelector('[data-xb-surface="popup"]')!;
    expect(popup.querySelector("h1")?.textContent).toBe("XBlocker");
    expect(popup.textContent).toContain("Active on x.com");
    expect(popup.querySelector('input[placeholder="Add username"]')).toBeTruthy();
    expect(popup.textContent).toContain("Protect whitelist");
    expect(popup.textContent).toContain("Confirm destructive actions");
    expect(popup.textContent).toContain("Keyboard mode");
  });

  test("PU-02 lists stored whitelist handles and the saved count", async () => {
    seedState({ whitelist: ["trusted_user", "researcher"] });
    await renderPopup(document.body);
    const popup = document.querySelector('[data-xb-surface="popup"]')!;
    expect(popup.textContent).toContain("@trusted_user");
    expect(popup.textContent).toContain("@researcher");
    expect(popup.textContent).toContain("2 saved");
    expect(popup.textContent).toContain("Whitelisted");
  });

  test("PU-03 injects popup styles exactly once across renders", async () => {
    await renderPopup(document.body);
    await renderPopup(document.body);
    expect(document.querySelectorAll("#xblocker-popup-styles")).toHaveLength(1);
  });

  test("PU-04 replaces previous content on re-render (no duplicate popups)", async () => {
    await renderPopup(document.body);
    await renderPopup(document.body);
    expect(document.querySelectorAll('[data-xb-surface="popup"]')).toHaveLength(1);
  });

  test("PU-05 reflects stored setting values on the toggles", async () => {
    seedState({
      settings: { confirmDestructiveActions: false, keyboardMode: true, protectWhitelist: false },
    });
    await renderPopup(document.body);
    const toggles = Array.from(
      document.querySelectorAll<HTMLInputElement>(".xb-switch-input"),
    );
    // Order matches renderSettings: protect, confirm, keyboard.
    expect(toggles.map((toggle) => toggle.checked)).toEqual([false, false, true]);
  });

  test("PU-06 falls back to default settings when none are stored", async () => {
    await renderPopup(document.body);
    const toggles = Array.from(
      document.querySelectorAll<HTMLInputElement>(".xb-switch-input"),
    );
    expect(toggles.map((toggle) => toggle.checked)).toEqual([true, true, false]);
  });
});

describe("popup whitelist form", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  async function render(): Promise<{ input: HTMLInputElement; form: HTMLFormElement }> {
    await renderPopup(document.body);
    return {
      input: document.querySelector<HTMLInputElement>(".xb-whitelist-input")!,
      form: document.querySelector<HTMLFormElement>(".xb-whitelist-form")!,
    };
  }

  test("PU-07 adds a normalized username and persists it", async () => {
    const { input, form } = await render();
    input.value = "@new_friend";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(storageFake.data["whitelist"]).toEqual(["new_friend"]);
    expect(document.body.textContent).toContain("@new_friend");
    expect(input.value).toBe("");
  });

  test("PU-08 rejects an invalid username (no save, value retained)", async () => {
    const { input, form } = await render();
    input.value = "bad name!";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(storageFake.setCalls).toHaveLength(0);
    expect(input.value).toBe("bad name!");
  });

  test("PU-09 ignores a duplicate username", async () => {
    seedState({ whitelist: ["existing"] });
    const { input, form } = await render();
    input.value = "existing";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("PU-10 removing a handle updates storage and the rendered list", async () => {
    seedState({ whitelist: ["removable", "keeper"] });
    await renderPopup(document.body);

    const removeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".xb-remove-button"),
    );
    // First row corresponds to "removable".
    removeButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(storageFake.data["whitelist"]).toEqual(["keeper"]);
    expect(document.body.textContent).not.toContain("@removable");
    expect(document.body.textContent).toContain("@keeper");
  });

  test("PU-11 BUG XB-BUG-05: removing one of two identical handles still shows one", async () => {
    // Storage can hold duplicates from other code paths. The popup filter
    // removes ALL matching handles, so removing one drops both — pin it.
    seedState({ whitelist: ["dupe", "dupe"] });
    await renderPopup(document.body);
    const removeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".xb-remove-button"),
    );
    removeButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(storageFake.data["whitelist"]).toEqual([]);
  });
});

describe("popup settings toggles", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PU-12 toggling a switch persists the new settings object", async () => {
    await renderPopup(document.body);
    const protectToggle = document.querySelector<HTMLInputElement>(".xb-switch-input")!;
    protectToggle.checked = false;
    protectToggle.dispatchEvent(new Event("change", { bubbles: true }));

    const stored = storageFake.data["settings"] as Record<string, boolean>;
    expect(stored.protectWhitelist).toBe(false);
  });

  test("PU-13 default settings merge with a partial stored settings object", async () => {
    seedState({ settings: { keyboardMode: true } });
    await renderPopup(document.body);
    const toggles = Array.from(
      document.querySelectorAll<HTMLInputElement>(".xb-switch-input"),
    );
    // protect/confirm fall back to defaults (true), keyboard is the stored true.
    expect(toggles.map((toggle) => toggle.checked)).toEqual([true, true, true]);
  });
});
