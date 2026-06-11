import { beforeEach, describe, expect, test } from "bun:test";

import { renderPopup } from "../entrypoints/popup/main.ts";

describe("Extension popup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";

    chrome.storage.local.get = (_keys, callback) => {
      callback({
        settings: {
          confirmDestructiveActions: true,
          keyboardMode: false,
          protectWhitelist: true,
        },
        whitelist: ["trusted_user", "researcher"],
      });
    };
  });

  test("renders active status, whitelist controls, and behavior settings", async () => {
    await renderPopup(document.body);

    const popup = document.querySelector('[data-xb-surface="popup"]');
    expect(popup).toBeTruthy();
    expect(popup.querySelector("h1").textContent).toBe("XBlocker");
    expect(popup.textContent).toContain("Active on x.com");
    expect(popup.querySelector('input[placeholder="Add username"]')).toBeTruthy();

    expect(popup.textContent).toContain("@trusted_user");
    expect(popup.textContent).toContain("@researcher");
    expect(popup.textContent).toContain("Protect whitelist");
    expect(popup.textContent).toContain("Confirm destructive actions");
    expect(popup.textContent).toContain("Keyboard mode");
  });
});
