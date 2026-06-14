// Catalog: TH-* (detectTheme / applyTheme), ST-* (ensureStyles), IC-* (createIcon),
// BT-* (createActionButton / setButtonIcon), TO-* (showToast), MD-* (showWhitelistModal).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createActionButton } from "../../entrypoints/content/buttons.ts";
import { createIcon } from "../../entrypoints/content/icons.ts";
import { showWhitelistModal } from "../../entrypoints/content/modal.ts";
import { ensureStyles } from "../../entrypoints/content/styles.ts";
import { applyTheme, detectTheme, observeThemeChanges } from "../../entrypoints/content/theme.ts";
import { showToast } from "../../entrypoints/content/toast.ts";
import { installManualTimers, settleMicrotasks, type ManualTimers } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

// happy-dom implements requestAnimationFrame with a captured native
// setImmediate, so manual setTimeout fakes never intercept it. Awaiting a
// chained frame guarantees every previously queued rAF callback has run.
function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function getToast(message: string): HTMLElement {
  const toast = Array.from(document.querySelectorAll<HTMLElement>(".xb-toast")).find(
    (node) => node.textContent?.includes(message) ?? false,
  );
  if (!toast) {
    throw new Error(`Unable to find a toast containing "${message}"`);
  }
  return toast;
}

function getModal(): HTMLElement {
  const modal = document.getElementById("xblocker-modal");
  if (!modal) {
    throw new Error("Whitelist modal is not in the document");
  }
  return modal;
}

function click(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("detectTheme", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("TH-01 defaults to light when no dark signal is present", () => {
    expect(detectTheme()).toBe("light");
  });

  test("TH-02 detects dark mode from html color-scheme", () => {
    document.documentElement.style.colorScheme = "dark";
    expect(detectTheme()).toBe("dark");
  });

  test("TH-03 detects dark mode from an inline black body background", () => {
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    expect(detectTheme()).toBe("dark");
  });

  test("TH-04 detects dark mode from a stylesheet-computed black body background", () => {
    document.body.style.backgroundColor = "";
    const sheet = document.createElement("style");
    sheet.textContent = "body { background-color: rgb(0, 0, 0); }";
    document.head.appendChild(sheet);
    expect(detectTheme()).toBe("dark");
  });

  test("TH-05 detects dark from [data-theme=dark] when the surface is indeterminate", () => {
    // Weak hints only apply once the surface can't settle the theme itself, so
    // clear the body background to make it indeterminate (see TH-05b / TD-05 for
    // the light-surface case where the hint is correctly ignored).
    document.body.style.backgroundColor = "";
    const node = document.createElement("div");
    node.setAttribute("data-theme", "dark");
    document.body.appendChild(node);
    expect(detectTheme()).toBe("dark");
  });

  test("TH-05b a [data-theme=dark] element does NOT flip a clearly light surface", () => {
    const node = document.createElement("div");
    node.setAttribute("data-theme", "dark");
    document.body.appendChild(node);
    expect(detectTheme()).toBe("light");
  });

  test("TH-06 detects dark from a black theme-color meta when the surface is indeterminate", () => {
    document.body.style.backgroundColor = "";
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#000000");
    document.head.appendChild(meta);
    expect(detectTheme()).toBe("dark");
  });

  test("TH-07 a non-black theme-color meta tag stays light", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#ffffff");
    document.head.appendChild(meta);
    expect(detectTheme()).toBe("light");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("TH-08 stamps data-xb-theme on every .xb-root node and nothing else", () => {
    const dock = document.createElement("div");
    dock.className = "xb-root xb-rail";
    const toastNode = document.createElement("div");
    toastNode.className = "xb-root xb-toast";
    const plain = document.createElement("div");
    document.body.append(dock, toastNode, plain);

    applyTheme();

    expect(dock.dataset.xbTheme).toBe("light");
    expect(toastNode.dataset.xbTheme).toBe("light");
    expect(plain.dataset.xbTheme).toBeUndefined();
  });

  test("TH-09 re-stamps roots when the page flips to dark", () => {
    const root = document.createElement("div");
    root.className = "xb-root";
    document.body.appendChild(root);

    applyTheme();
    expect(root.dataset.xbTheme).toBe("light");

    document.documentElement.style.colorScheme = "dark";
    applyTheme();
    expect(root.dataset.xbTheme).toBe("dark");
  });

  test("TH-10 observeThemeChanges re-stamps roots when a watched attribute mutates", async () => {
    const root = document.createElement("div");
    root.className = "xb-root";
    document.body.appendChild(root);
    // Indeterminate surface so the watched data-theme mutation is what decides.
    document.body.style.backgroundColor = "";
    applyTheme();
    expect(root.dataset.xbTheme).toBe("light");

    const observer = observeThemeChanges();
    document.documentElement.setAttribute("data-theme", "dark");
    await nextAnimationFrame();

    expect(root.dataset.xbTheme).toBe("dark");
    observer.disconnect();
  });
});

describe("ensureStyles", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("ST-01 injects style#xblocker-styles into head with OKLCH tokens", () => {
    ensureStyles();
    const style = document.getElementById("xblocker-styles");
    expect(style).toBeTruthy();
    expect(style?.tagName).toBe("STYLE");
    expect(style?.parentElement).toBe(document.head);
    expect(style?.textContent).toContain("oklch(");
    expect(style?.textContent).toContain(".xb-root");
    expect(style?.textContent).toContain("--xb-primary");
  });

  test("ST-02 repeated calls keep a single style node", () => {
    ensureStyles();
    ensureStyles();
    ensureStyles();
    expect(document.querySelectorAll("style#xblocker-styles")).toHaveLength(1);
  });

  test("ST-03 re-running restores tampered content on the same node", () => {
    ensureStyles();
    const style = document.getElementById("xblocker-styles");
    expect(style).toBeTruthy();
    if (!style) {
      return;
    }
    style.textContent = "/* tampered */";

    ensureStyles();

    expect(document.getElementById("xblocker-styles")).toBe(style);
    expect(style.textContent).toContain("oklch(");
    expect(style.textContent).not.toContain("tampered");
  });
});

describe("createIcon", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("IC-01 builds an 18px currentColor-stroked SVG for each glyph type", () => {
    for (const type of ["block", "mute", "whitelist", "settings", "check", "cross"] as const) {
      const svg = createIcon(type);
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(svg.getAttribute("width")).toBe("18");
      expect(svg.getAttribute("height")).toBe("18");
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.innerHTML).toContain('stroke="currentColor"');
      expect(svg.classList.contains("xb-spin")).toBe(false);
    }
  });

  test("IC-02 applies an explicit size to width and height", () => {
    const svg = createIcon("mute", 24);
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
  });

  test("IC-03 the loading icon spins via the xb-spin class", () => {
    const svg = createIcon("loading");
    expect(svg.classList.contains("xb-spin")).toBe(true);
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(svg.innerHTML).toContain("stroke-dasharray");
    expect(svg.getAttribute("width")).toBe("18");
  });

  test("IC-04 the drag icon is six distinct currentColor dots", () => {
    const svg = createIcon("drag", 14);
    expect(svg.getAttribute("width")).toBe("14");
    const circles = Array.from(svg.querySelectorAll("circle"));
    expect(circles).toHaveLength(6);
    for (const circle of circles) {
      expect(circle.getAttribute("fill")).toBe("currentColor");
    }
    const centers = circles.map(
      (circle) => `${circle.getAttribute("cx")},${circle.getAttribute("cy")}`,
    );
    expect(new Set(centers).size).toBe(6);
  });
});

describe("createActionButton", () => {
  let timers: ManualTimers | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    timers = installManualTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("BT-01 renders an idle xb-btn with label, title, and stacked icon slots", () => {
    const button = createActionButton({
      action: "settings",
      icon: "settings",
      label: "Open settings",
      onClick: () => {},
    });

    expect(button.className).toBe("xb-btn");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.dataset.action).toBe("settings");
    expect(button.dataset.state).toBe("idle");
    expect(button.getAttribute("aria-label")).toBe("Open settings");
    expect(button.getAttribute("title")).toBe("Open settings");
    expect(button.querySelector(".xb-icon-main svg")).toBeTruthy();
    expect(button.querySelector(".xb-icon-status")?.children).toHaveLength(0);
  });

  test("BT-02 click runs busy -> success -> idle with aria-busy and status icons", async () => {
    const gate: { release?: () => void } = {};
    const button = createActionButton({
      action: "block",
      icon: "block",
      label: "Block @target",
      onClick: () =>
        new Promise<void>((resolve) => {
          gate.release = resolve;
        }),
    });
    document.body.appendChild(button);

    click(button);
    expect(button.dataset.state).toBe("busy");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".xb-icon-status svg")?.classList.contains("xb-spin")).toBe(true);

    gate.release?.();
    await settleMicrotasks();

    expect(button.dataset.state).toBe("success");
    expect(button.hasAttribute("aria-busy")).toBe(false);
    // Check-mark path replaces the spinner in the status slot.
    expect(button.querySelector(".xb-icon-status svg")?.innerHTML).toContain("M5 12.5");
    expect(timers?.pendingDelays()).toEqual([1400]);

    timers?.flush();
    expect(button.dataset.state).toBe("idle");
  });

  test("BT-03 a throwing onClick lands in error state, then resets to idle", async () => {
    const button = createActionButton({
      action: "mute",
      icon: "mute",
      label: "Mute @target",
      onClick: () => Promise.reject(new Error("boom")),
    });
    document.body.appendChild(button);

    click(button);
    await settleMicrotasks();

    expect(button.dataset.state).toBe("error");
    expect(button.hasAttribute("aria-busy")).toBe(false);
    // Cross path in the status slot.
    expect(button.querySelector(".xb-icon-status svg")?.innerHTML).toContain("M7 7l10 10");

    timers?.flush();
    expect(button.dataset.state).toBe("idle");
  });

  test("BT-04 re-clicks are ignored until the state resets to idle", async () => {
    const gate: { release?: () => void } = {};
    let calls = 0;
    const button = createActionButton({
      action: "whitelist",
      icon: "whitelist",
      label: "Whitelist @target",
      onClick: () => {
        calls++;
        return new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      },
    });
    document.body.appendChild(button);

    click(button);
    expect(calls).toBe(1);
    click(button);
    expect(calls).toBe(1); // busy: ignored

    gate.release?.();
    await settleMicrotasks();
    expect(button.dataset.state).toBe("success");
    click(button);
    expect(calls).toBe(1); // success (reset timer pending): still ignored

    timers?.flush();
    expect(button.dataset.state).toBe("idle");
    click(button);
    expect(calls).toBe(2); // idle again: accepted
  });

  test("BT-05 onClick receives the button element itself", async () => {
    const seen: { button?: HTMLButtonElement } = {};
    const button = createActionButton({
      action: "whitelist",
      icon: "whitelist",
      label: "Whitelist @target",
      onClick: (self) => {
        seen.button = self;
      },
    });
    document.body.appendChild(button);

    click(button);
    await settleMicrotasks();

    expect(seen.button).toBe(button);
  });
});

describe("showToast", () => {
  let timers: ManualTimers | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    timers = installManualTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("TO-01 appends a status toast carrying the message, dot, and type", () => {
    showToast("Blocked @user", "success");
    const toast = getToast("Blocked @user");
    expect(toast.classList.contains("xb-root")).toBe(true);
    expect(toast.dataset.type).toBe("success");
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.querySelector(".xb-toast-dot")).toBeTruthy();
  });

  test("TO-02 defaults to the info type when none is given", () => {
    showToast("Default type");
    expect(getToast("Default type").dataset.type).toBe("info");
  });

  test("TO-03 opens on the next animation frame", async () => {
    showToast("Opening soon");
    const toast = getToast("Opening soon");
    expect(toast.dataset.state).toBe("closed");

    await nextAnimationFrame();
    expect(toast.dataset.state).toBe("open");
  });

  test("TO-04 auto-dismisses through the 3000ms close + 180ms removal chain", () => {
    showToast("Temporary notice");
    const toast = getToast("Temporary notice");
    expect(timers?.pendingDelays()).toEqual([3000]);

    timers?.flushUpTo(3000);
    expect(toast.dataset.state).toBe("closed");
    expect(document.body.contains(toast)).toBe(true);
    expect(timers?.pendingDelays()).toEqual([180]);

    timers?.flush();
    expect(document.body.contains(toast)).toBe(false);
  });

  test("TO-05 click dismisses an open toast immediately", async () => {
    showToast("Click to dismiss", "warning");
    const toast = getToast("Click to dismiss");
    await nextAnimationFrame();
    expect(toast.dataset.state).toBe("open");

    click(toast);
    expect(toast.dataset.state).toBe("closed");

    timers?.flush();
    expect(document.body.contains(toast)).toBe(false);
  });

  test("TO-06 stamps the detected theme on the toast root", () => {
    document.documentElement.style.colorScheme = "dark";
    showToast("Dark themed");
    expect(getToast("Dark themed").dataset.xbTheme).toBe("dark");
  });
});

describe("showWhitelistModal", () => {
  let timers: ManualTimers | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    timers = installManualTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("MD-01 renders the backdrop, dialog, input, and action buttons", () => {
    showWhitelistModal();
    const backdrop = getModal();
    expect(backdrop.classList.contains("xb-root")).toBe(true);
    expect(backdrop.classList.contains("xb-modal-backdrop")).toBe(true);

    const dialog = backdrop.querySelector<HTMLElement>(".xb-modal");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("Add user to whitelist");
    expect(backdrop.querySelector("input#xb-username-input")).toBeTruthy();
    expect(backdrop.querySelector("button.xb-modal-confirm")).toBeTruthy();
    expect(backdrop.querySelector("button.xb-modal-cancel")).toBeTruthy();
  });

  test("MD-02 opens on the next animation frame with the detected theme", async () => {
    showWhitelistModal();
    expect(getModal().dataset.state).toBe("closed");
    expect(getModal().dataset.xbTheme).toBe("light");

    await nextAnimationFrame();
    expect(getModal().dataset.state).toBe("open");
  });

  test("MD-03 repeated opens keep a single, fresh modal instance", () => {
    showWhitelistModal();
    const firstInput = document.querySelector<HTMLInputElement>("#xb-username-input");
    expect(firstInput).toBeTruthy();
    if (firstInput) {
      firstInput.value = "draft_user";
    }

    showWhitelistModal();
    expect(document.querySelectorAll("#xblocker-modal")).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>("#xb-username-input")?.value).toBe("");
  });

  test("MD-04 confirm persists the trimmed, @-stripped username and closes", async () => {
    showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#xb-username-input");
    expect(input).toBeTruthy();
    if (!input) {
      return;
    }
    input.value = "  @added_via_modal  ";

    click(document.querySelector<HTMLButtonElement>(".xb-modal-confirm") ?? input);
    await settleMicrotasks();

    expect(storageFake.data["whitelist"]).toEqual(["added_via_modal"]);
    expect(storageFake.setCalls).toEqual([{ whitelist: ["added_via_modal"] }]);
    const toast = getToast("Added @added_via_modal to whitelist");
    expect(toast.dataset.type).toBe("success");
    expect(getModal().dataset.state).toBe("closed");

    timers?.flush();
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-05 an already-whitelisted username warns without writing", async () => {
    storageFake.data["whitelist"] = ["dupe_user"];
    showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#xb-username-input");
    expect(input).toBeTruthy();
    if (!input) {
      return;
    }
    input.value = "@dupe_user";

    click(document.querySelector<HTMLButtonElement>(".xb-modal-confirm") ?? input);
    await settleMicrotasks();

    expect(storageFake.setCalls).toHaveLength(0);
    const toast = getToast("@dupe_user is already in the whitelist");
    expect(toast.dataset.type).toBe("warning");

    timers?.flush();
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-06 blank, @-only, or invalid input keeps the modal open with no storage traffic", async () => {
    showWhitelistModal();
    await nextAnimationFrame();
    const input = document.querySelector<HTMLInputElement>("#xb-username-input");
    const confirm = document.querySelector<HTMLButtonElement>(".xb-modal-confirm");
    expect(input).toBeTruthy();
    expect(confirm).toBeTruthy();
    if (!input || !confirm) {
      return;
    }

    input.value = "   ";
    click(confirm);
    await settleMicrotasks();

    input.value = "@";
    click(confirm);
    await settleMicrotasks();

    // Invalid handles are rejected before any storage read (XB-BUG-03 fixed).
    input.value = "not a handle";
    click(confirm);
    await settleMicrotasks();

    expect(storageFake.getCalls).toHaveLength(0);
    expect(storageFake.setCalls).toHaveLength(0);
    expect(getModal().dataset.state).toBe("open");
    expect(timers?.pendingDelays()).toHaveLength(0);
  });

  test("MD-07 Enter submits the username while other keys do not", async () => {
    showWhitelistModal();
    const input = document.querySelector<HTMLInputElement>("#xb-username-input");
    expect(input).toBeTruthy();
    if (!input) {
      return;
    }
    input.value = "enter_user";

    input.dispatchEvent(new KeyboardEvent("keypress", { key: "a", bubbles: true }));
    await settleMicrotasks();
    expect(storageFake.setCalls).toHaveLength(0);

    input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
    await settleMicrotasks();
    expect(storageFake.data["whitelist"]).toEqual(["enter_user"]);

    timers?.flush();
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-08 Escape on the document closes without saving; other keys do not", async () => {
    showWhitelistModal();
    await nextAnimationFrame();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(getModal().dataset.state).toBe("open");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(getModal().dataset.state).toBe("closed");

    timers?.flush();
    expect(document.getElementById("xblocker-modal")).toBeNull();
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("MD-09 backdrop click closes, but clicks inside the dialog do not", async () => {
    showWhitelistModal();
    await nextAnimationFrame();
    const backdrop = getModal();
    const dialog = backdrop.querySelector<HTMLElement>(".xb-modal");
    expect(dialog).toBeTruthy();
    if (!dialog) {
      return;
    }

    click(dialog);
    expect(backdrop.dataset.state).toBe("open");
    expect(timers?.pendingDelays()).toHaveLength(0);

    click(backdrop);
    expect(backdrop.dataset.state).toBe("closed");

    timers?.flush();
    expect(document.getElementById("xblocker-modal")).toBeNull();
  });

  test("MD-10 Cancel closes the modal without saving", async () => {
    showWhitelistModal();
    await nextAnimationFrame();
    const cancel = document.querySelector<HTMLButtonElement>(".xb-modal-cancel");
    expect(cancel).toBeTruthy();
    if (!cancel) {
      return;
    }

    click(cancel);
    expect(getModal().dataset.state).toBe("closed");

    timers?.flush();
    expect(document.getElementById("xblocker-modal")).toBeNull();
    expect(storageFake.setCalls).toHaveLength(0);
  });

  test("MD-11 a whitelist read failure warns and keeps the modal open", async () => {
    // The aborted save (XB-BUG-08 family fix) surfaces as a retry prompt.
    storageFake.data["whitelist"] = ["existing_user"];
    storageFake.failNextGet = true;
    showWhitelistModal();
    await nextAnimationFrame();
    const input = document.querySelector<HTMLInputElement>("#xb-username-input");
    expect(input).toBeTruthy();
    if (!input) {
      return;
    }
    input.value = "fresh_user";

    click(document.querySelector<HTMLButtonElement>(".xb-modal-confirm") ?? input);
    await settleMicrotasks();

    expect(storageFake.setCalls).toHaveLength(0);
    expect(storageFake.data["whitelist"]).toEqual(["existing_user"]);
    const toast = getToast("Could not update the whitelist. Try again.");
    expect(toast.dataset.type).toBe("warning");
    expect(getModal().dataset.state).toBe("open");
  });
});
