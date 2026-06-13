// Catalog: TH-* (detectTheme), IC-* (createActionIcon), AB-* (addButtons),
// TO-* (showToast), MD-* (showWhitelistModal), RB-* (createReplyActionButton).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hooks } from "../helpers/content-hooks.ts";
import {
  installImmediateTimers,
  installManualTimers,
  settleMicrotasks,
} from "../helpers/timers.ts";
import { resetTestEnvironment, setWindowLocation, storageFake } from "../setup.ts";

function findBodyElementByText(text: string): HTMLElement {
  const element = Array.from(document.body.children).find(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && (node.textContent?.includes(text) ?? false),
  );
  if (!element) {
    throw new Error(`Unable to find body element containing ${text}`);
  }
  return element;
}

describe("detectTheme", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("TH-01 defaults to light when no dark signals are present", () => {
    const theme = hooks.detectTheme();
    expect(theme.isDark).toBe(false);
    expect(theme.colors.text).toBe("#0f1419");
  });

  test("TH-02 detects dark mode from html color-scheme", () => {
    document.documentElement.style.colorScheme = "dark";
    const theme = hooks.detectTheme();
    expect(theme.isDark).toBe(true);
    expect(theme.colors.text).toBe("#e7e9ea");
  });

  test("TH-03 detects dark mode from a black body background", () => {
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    const theme = hooks.detectTheme();
    expect(theme.isDark).toBe(true);
  });

  test("TH-04 detects dark mode from a [data-theme=dark] element", () => {
    const node = document.createElement("div");
    node.setAttribute("data-theme", "dark");
    document.body.appendChild(node);
    const theme = hooks.detectTheme();
    expect(theme.isDark).toBe(true);
  });

  test("TH-05 detects dark mode from a black theme-color meta tag", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#000000");
    document.head.appendChild(meta);
    const theme = hooks.detectTheme();
    expect(theme.isDark).toBe(true);
  });

  test("TH-06 keeps brand accent colors stable across themes", () => {
    const light = hooks.detectTheme();
    document.documentElement.style.colorScheme = "dark";
    const dark = hooks.detectTheme();
    for (const key of ["primary", "success", "warning", "danger"] as const) {
      expect(dark.colors[key]).toBe(light.colors[key]);
    }
  });
});

describe("createActionIcon", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("IC-01 builds a sized SVG for each concrete action type", () => {
    for (const type of ["block", "mute", "whitelist", "settings"] as const) {
      const svg = hooks.createActionIcon(type, 18, "#fff");
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(svg.getAttribute("width")).toBe("18");
      expect(svg.getAttribute("height")).toBe("18");
      expect(svg.innerHTML.length).toBeGreaterThan(0);
    }
  });

  test("IC-02 the loading icon embeds an animation and returns early", () => {
    const svg = hooks.createActionIcon("loading", 15, "currentColor");
    expect(svg.innerHTML).toContain("animate");
  });

  test("IC-03 applies default size and color when omitted", () => {
    const svg = hooks.createActionIcon("block");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.innerHTML).toContain("currentColor");
  });
});

describe("addButtons", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
  });

  test("AB-01 renders exactly one reply action bar with the three actions", () => {
    hooks.addButtons();
    const bar = document.querySelector('[data-xb-surface="reply-action-bar"]');
    expect(bar).toBeTruthy();
    const labels = Array.from(bar!.querySelectorAll("button"))
      .map((button) => button.textContent?.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    expect(labels).toContain("Block replies");
    expect(labels).toContain("Mute replies");
    expect(labels).toContain("Whitelist");
  });

  test("AB-02 is idempotent: repeated calls leave a single action bar", () => {
    hooks.addButtons();
    hooks.addButtons();
    hooks.addButtons();
    expect(document.querySelectorAll('[data-xb-surface="reply-action-bar"]')).toHaveLength(1);
  });

  test("AB-03 removes stale legacy containers", () => {
    for (const id of ["xblocker-dashboard", "xblocker-buttons"]) {
      const stale = document.createElement("div");
      stale.id = id;
      document.body.appendChild(stale);
    }
    hooks.addButtons();
    expect(document.getElementById("xblocker-dashboard")).toBeNull();
    expect(document.getElementById("xblocker-buttons")).toBeNull();
  });

  test("AB-04 exposes the toolbar role, status, progress bar, and settings", () => {
    hooks.addButtons();
    const bar = document.getElementById("xblocker-reply-action-bar")!;
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect(bar.querySelector(".xb-reply-action-status")?.textContent).toBe("0 blocked");
    expect(bar.querySelector(".xb-progress-bar")).toBeTruthy();
    expect(bar.querySelector(".xb-reply-action-settings")).toBeTruthy();
  });

  test("AB-05 settings button points users to the extension popup", () => {
    const manual = installManualTimers();
    try {
      hooks.addButtons();
      document
        .querySelector<HTMLButtonElement>(".xb-reply-action-settings")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(document.body.textContent).toContain("Use the XBlocker extension popup for settings.");
    } finally {
      manual.uninstall();
    }
  });
});

describe("showToast", () => {
  let timers: ReturnType<typeof installManualTimers> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    timers = installManualTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("TO-01 appends a toast carrying the message text", () => {
    hooks.showToast("Hello world", "success");
    const toast = Array.from(document.body.children).find((node) =>
      node.textContent?.includes("Hello world"),
    );
    expect(toast).toBeTruthy();
  });

  test("TO-02 auto-dismisses after the timeout chain elapses", () => {
    hooks.showToast("Temporary", "info");
    expect(document.body.textContent).toContain("Temporary");
    timers!.flush();
    expect(document.body.textContent).not.toContain("Temporary");
  });

  test("TO-03 dismisses on click", () => {
    hooks.showToast("Click me", "warning");
    const toast = findBodyElementByText("Click me");
    toast.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    timers!.flush();
    expect(document.body.contains(toast)).toBe(false);
  });

  test("TO-04 defaults to the info color when no type is given", () => {
    hooks.showToast("Default type");
    const toast = findBodyElementByText("Default type");
    expect(toast.style.cssText).toContain("#1d9bf0");
  });

  test("TO-05 appends toast animations to the shared style node once", () => {
    const style = document.createElement("style");
    style.id = "xblocker-styles";
    document.head.appendChild(style);

    hooks.showToast("Animated");
    hooks.showToast("Still one animation block");

    expect(style.textContent?.match(/slideInToast/g)).toHaveLength(1);
  });
});

describe("showWhitelistModal", () => {
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    timers = installImmediateTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("MD-01 renders the modal with input and action buttons", () => {
    hooks.showWhitelistModal();
    const modal = document.getElementById("xblocker-modal")!;
    expect(modal).toBeTruthy();
    expect(modal.querySelector("#username-input")).toBeTruthy();
    expect(modal.querySelector("#add-btn")).toBeTruthy();
    expect(modal.querySelector("#cancel-btn")).toBeTruthy();
  });

  test("MD-02 only one modal exists even after repeated opens", () => {
    hooks.showWhitelistModal();
    hooks.showWhitelistModal();
    expect(document.querySelectorAll("#xblocker-modal")).toHaveLength(1);
  });

  test("MD-03 Cancel closes the modal", () => {
    hooks.showWhitelistModal();
    const cancel = document.querySelector<HTMLButtonElement>("#cancel-btn")!;
    cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-04 Add persists the typed username and closes the modal", () => {
    hooks.showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#username-input")!;
    input.value = "added_via_modal";
    document
      .querySelector<HTMLButtonElement>("#add-btn")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(storageFake.data["whitelist"]).toEqual(["added_via_modal"]);
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-05 a blank username neither saves nor closes", () => {
    hooks.showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#username-input")!;
    input.value = "   ";
    document
      .querySelector<HTMLButtonElement>("#add-btn")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(storageFake.setCalls).toHaveLength(0);
    expect(document.getElementById("xblocker-modal")).toBeTruthy();
  });

  test("MD-06 Enter submits the username", () => {
    hooks.showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#username-input")!;
    input.value = "enter_user";
    input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
    expect(storageFake.data["whitelist"]).toEqual(["enter_user"]);
  });

  test("MD-07 clicking the backdrop closes the modal", () => {
    hooks.showWhitelistModal();
    const modal = document.getElementById("xblocker-modal")!;
    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-08 appends modal animations to the shared style node", () => {
    const style = document.createElement("style");
    style.id = "xblocker-styles";
    document.head.appendChild(style);

    hooks.showWhitelistModal();

    expect(style.textContent).toContain("@keyframes fadeIn");
    expect(style.textContent).toContain("@keyframes slideInModal");
  });

  test("MD-10 focus, blur, and hover states restore their inline styles", () => {
    hooks.showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#username-input")!;
    const cancel = document.querySelector<HTMLButtonElement>("#cancel-btn")!;
    const add = document.querySelector<HTMLButtonElement>("#add-btn")!;

    input.dispatchEvent(new Event("focus"));
    expect(input.style.borderColor).toBe("#00ba7c");
    input.dispatchEvent(new Event("blur"));
    expect(input.style.borderColor).toBe("rgba(0, 0, 0, 0.08)");

    cancel.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(cancel.style.background).toBe("rgba(0, 0, 0, 0.03)");
    cancel.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(cancel.style.background).toBe("transparent");

    add.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(add.style.transform).toBe("translateY(-1px)");
    add.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(add.style.transform).toBe("translateY(0)");
  });

  test("MD-11 Escape closes from the input and document key handlers", () => {
    hooks.showWhitelistModal();
    document
      .querySelector<HTMLInputElement>("#username-input")!
      .dispatchEvent(new KeyboardEvent("keypress", { key: "Escape", bubbles: true }));
    expect(document.getElementById("xblocker-modal")).toBeNull();

    hooks.showWhitelistModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });
});

describe("createReplyActionButton interaction", () => {
  let manual: ReturnType<typeof installManualTimers> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
  });

  afterEach(() => {
    manual?.uninstall();
    manual = null;
  });

  test("RB-01 runs the action and shows a transient Done state on success", async () => {
    manual = installManualTimers();
    let ran = false;
    const button = hooks.createReplyActionButton(
      {
        type: "whitelist",
        color: "success",
        text: "Whitelist",
        action: () => {
          ran = true;
        },
      },
      hooks.detectTheme(),
    );
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks();

    expect(ran).toBe(true);
    expect(button.querySelector("span")?.textContent).toBe("Done");
    expect(button.disabled).toBe(true);

    manual.flush();
    await settleMicrotasks();
    expect(button.querySelector("span")?.textContent).toBe("Whitelist");
    expect(button.disabled).toBe(false);
  });

  test("RB-02 shows an Error state and recovers when the action throws", async () => {
    manual = installManualTimers();
    const button = hooks.createReplyActionButton(
      {
        type: "block",
        color: "danger",
        text: "Block replies",
        action: () => {
          throw new Error("boom");
        },
      },
      hooks.detectTheme(),
    );
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks();
    expect(button.querySelector("span")?.textContent).toBe("Error");

    manual.flush();
    await settleMicrotasks();
    expect(button.querySelector("span")?.textContent).toBe("Block replies");
    expect(button.disabled).toBe(false);
  });

  test("RB-03 applies hover styles on mouseenter and restores on mouseleave", () => {
    const theme = hooks.detectTheme();
    const button = hooks.createReplyActionButton(
      { type: "mute", color: "warning", text: "Mute replies", action: () => {} },
      theme,
    );
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(-1px)");
    button.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(button.style.transform).toBe("translateY(0)");
  });

  test("RB-04 whitelist button click opens the whitelist modal end to end", async () => {
    manual = installManualTimers();
    storageFake.data["whitelist"] = [];
    hooks.addButtons();
    const whitelistButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#xblocker-reply-action-bar button"),
    ).find((button) => button.textContent?.includes("Whitelist"))!;

    whitelistButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks();

    expect(document.getElementById("xblocker-modal")).toBeTruthy();
  });
});
