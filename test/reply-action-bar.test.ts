import { beforeEach, describe, expect, test } from "bun:test";

globalThis.__XB_TEST__ = true;
await import("../entrypoints/content.ts");
delete globalThis.__XB_TEST__;

const hooks = globalThis.__xblockerTestHooks;

describe("Reply Action Bar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "x.com",
        href: "https://x.com/user/status/123456789",
      },
      writable: true,
    });
  });

  test("renders the core reply actions directly in one contextual action bar", () => {
    hooks.addButtons();

    const actionBar = document.querySelector('[data-xb-surface="reply-action-bar"]');
    expect(actionBar).toBeTruthy();
    expect(document.getElementById("xblocker-dashboard")).toBeNull();

    const actionLabels = Array.from(actionBar.querySelectorAll("button")).map((button) =>
      button.textContent.trim().replace(/\s+/g, " "),
    );

    expect(actionLabels).toContain("Block replies");
    expect(actionLabels).toContain("Mute replies");
    expect(actionLabels).toContain("Whitelist");
  });
});
