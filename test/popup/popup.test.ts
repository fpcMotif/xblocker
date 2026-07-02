// Catalog: PU-* (renderPopup, whitelist form, settings toggles, max replies input, normalizeUsername).
import { beforeEach, describe, expect, test } from "bun:test";

import { formatLastSync, mountPopupIfPresent, renderPopup } from "../../entrypoints/popup/main.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

/** A minimal active BlockedAccount map entry for summary-card tests. */
function seedAccount(key: string, counts: { blockCount: number; muteCount: number }): unknown {
  return {
    key,
    handle: `user_${key}`,
    idUnknown: false,
    xUserId: key,
    firstActionAt: 1,
    lastActionAt: 1,
    status: "active",
    actions: [],
    ...counts,
  };
}

function cardValues(): string[] {
  return Array.from(document.querySelectorAll(".xb-card-value")).map(
    (node) => node.textContent ?? "",
  );
}

function seedState(overrides: {
  whitelist?: string[];
  settings?: Partial<{
    confirmDestructiveActions: boolean;
    keyboardMode: boolean;
    maxReplies: unknown;
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
    const toggles = Array.from(document.querySelectorAll<HTMLInputElement>(".xb-switch-input"));
    // Order matches renderSettings: protect, confirm, keyboard.
    expect(toggles.map((toggle) => toggle.checked)).toEqual([false, false, true]);
  });

  test("PU-06 falls back to default settings when none are stored", async () => {
    await renderPopup(document.body);
    const toggles = Array.from(document.querySelectorAll<HTMLInputElement>(".xb-switch-input"));
    expect(toggles.map((toggle) => toggle.checked)).toEqual([true, true, false]);
  });

  test("PU-17 the summary cards show the real blocked/muted/whitelisted counts", async () => {
    storageFake.data["blockedAccounts"] = {
      "1": seedAccount("1", { blockCount: 2, muteCount: 0 }),
      "2": seedAccount("2", { blockCount: 0, muteCount: 1 }),
      "3": seedAccount("3", { blockCount: 1, muteCount: 1 }),
    };
    seedState({ whitelist: ["trusted_user"] });

    await renderPopup(document.body);

    // blocked: accounts 1+3, muted: accounts 2+3, whitelist: 1 entry.
    expect(cardValues()).toEqual(["2", "2", "1"]);
  });

  test("PU-18 a block recorded while the popup is open updates the cards live", async () => {
    type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    const listeners: ChangeListener[] = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install a runtime onChanged fake the static chrome typings don't model.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    chromeStorage["onChanged"] = {
      addListener: (fn: ChangeListener) => listeners.push(fn),
      removeListener: () => {},
    };
    try {
      await renderPopup(document.body);
      expect(cardValues()).toEqual(["0", "0", "0"]);

      const map = { "9": seedAccount("9", { blockCount: 1, muteCount: 0 }) };
      for (const listener of listeners) listener({ blockedAccounts: { newValue: map } }, "local");

      expect(cardValues()).toEqual(["1", "0", "0"]);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
    }
  });

  test("PU-19 adding and removing a whitelist handle updates the card and the saved note", async () => {
    seedState({ whitelist: ["first_user"] });
    await renderPopup(document.body);
    const popup = document.querySelector('[data-xb-surface="popup"]')!;

    const input = popup.querySelector<HTMLInputElement>(".xb-whitelist-input")!;
    input.value = "second_user";
    popup
      .querySelector("form.xb-whitelist-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(popup.textContent).toContain("2 saved");
    expect(cardValues()[2]).toBe("2");

    popup
      .querySelector<HTMLButtonElement>(".xb-remove-button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popup.textContent).toContain("1 saved");
    expect(cardValues()[2]).toBe("1");
  });
});

describe("formatLastSync", () => {
  test("PU-20 formats never/just-now/minutes/hours/days", () => {
    const now = 10 * 24 * 60 * 60_000;
    expect(formatLastSync({}, now)).toBe("never synced");
    expect(formatLastSync({ lastSyncAt: now - 10_000 }, now)).toBe("synced just now");
    expect(formatLastSync({ lastSyncAt: now - 5 * 60_000 }, now)).toBe("synced 5m ago");
    expect(formatLastSync({ lastSyncAt: now - 3 * 60 * 60_000 }, now)).toBe("synced 3h ago");
    expect(formatLastSync({ lastSyncAt: now - 2 * 24 * 60 * 60_000 }, now)).toBe("synced 2d ago");
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

  test("PU-09 rejects reserved X paths", async () => {
    const { input, form } = await render();
    input.value = "home";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(storageFake.setCalls).toHaveLength(0);
    expect(input.value).toBe("home");
  });

  test("PU-10 ignores a duplicate username", async () => {
    seedState({ whitelist: ["existing"] });
    const { input, form } = await render();
    input.value = "existing";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("PU-11 removing a handle updates storage and the rendered list", async () => {
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

  test("PU-12 BUG XB-BUG-05: removing one of two identical handles drops both", async () => {
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

  test("PU-13 toggling a switch persists the new settings object", async () => {
    await renderPopup(document.body);
    const protectToggle = document.querySelector<HTMLInputElement>(".xb-switch-input")!;
    protectToggle.checked = false;
    protectToggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 50,
      protectWhitelist: false,
    });
  });

  test("PU-14 default settings merge with a partial stored settings object", async () => {
    seedState({ settings: { keyboardMode: true } });
    await renderPopup(document.body);
    const toggles = Array.from(document.querySelectorAll<HTMLInputElement>(".xb-switch-input"));
    // protect/confirm fall back to defaults (true), keyboard is the stored true.
    expect(toggles.map((toggle) => toggle.checked)).toEqual([true, true, true]);
  });

  test("PU-15 auto-renders into #app when mounted", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);

    mountPopupIfPresent();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.querySelector('[data-xb-surface="popup"]')).toBeTruthy();
  });
});

describe("popup max replies setting", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  async function renderMaxRepliesInput(): Promise<HTMLInputElement> {
    await renderPopup(document.body);
    return document.querySelector<HTMLInputElement>(".xb-number-input")!;
  }

  test("PU-16 renders the number input with the default of 50", async () => {
    const input = await renderMaxRepliesInput();
    expect(input.getAttribute("aria-label")).toBe("Max replies per run");
    expect(input.value).toBe("50");
  });

  test("PU-17 renders a stored in-range value as-is", async () => {
    seedState({ settings: { maxReplies: 75 } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("75");
  });

  test("PU-18 clamps a stored out-of-range value on render (999 -> 200)", async () => {
    seedState({ settings: { maxReplies: 999 } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("200");
  });

  test("PU-19 falls back to 50 when the stored value is garbage", async () => {
    seedState({ settings: { maxReplies: "lots" } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("50");
  });

  test("PU-20 change event persists the clamped value and snaps the input (500 -> 200)", async () => {
    const input = await renderMaxRepliesInput();
    input.value = "500";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(input.value).toBe("200");
    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 200,
      protectWhitelist: true,
    });
  });

  test("PU-21 input event persists the normalized value without rewriting the field", async () => {
    const input = await renderMaxRepliesInput();
    input.value = "500";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Storage holds the normalized value, but the field keeps the user's
    // keystrokes — only "change" is allowed to snap the displayed value.
    expect(input.value).toBe("500");
    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 200,
      protectWhitelist: true,
    });
  });

  test("PU-22 non-numeric input falls back to 50", async () => {
    seedState({ settings: { maxReplies: 120 } });
    const input = await renderMaxRepliesInput();
    // A number input reports "" for non-numeric typing (badInput).
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 50,
      protectWhitelist: true,
    });

    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("50");
  });

  test("PU-23 parses a stored numeric string on load ('120' -> 120)", async () => {
    seedState({ settings: { maxReplies: "120" } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("120");
  });

  test("PU-24 falls back to 50 when the stored value is neither number nor string", async () => {
    seedState({ settings: { maxReplies: null } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("50");
  });

  test("PU-25 clamps a stored below-range value up on load (0 -> 1)", async () => {
    seedState({ settings: { maxReplies: 0 } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("1");
  });

  test("PU-26 truncates a stored fractional value on load (75.9 -> 75)", async () => {
    seedState({ settings: { maxReplies: 75.9 } });
    const input = await renderMaxRepliesInput();
    expect(input.value).toBe("75");
  });

  test("PU-27 changing the input to 999 snaps it to 200 and persists maxReplies 200", async () => {
    const input = await renderMaxRepliesInput();
    input.value = "999";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(input.value).toBe("200");
    expect(storageFake.data["settings"]).toEqual({
      confirmDestructiveActions: true,
      keyboardMode: false,
      maxReplies: 200,
      protectWhitelist: true,
    });
  });
});
