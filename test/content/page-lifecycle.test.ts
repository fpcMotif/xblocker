// Catalog: PL-* (checkPageAndAddButton / addButtons / observeThemeChanges /
// initializeXBlocker / runContentScript / content-script default export / test hooks).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { computeRailY } from "../../entrypoints/content/position.ts";
import { COLLAPSE_GRACE_MS, DWELL_MS, type ReplyRail } from "../../entrypoints/content/rail.ts";
import { hooks } from "../helpers/content-hooks.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, setWindowLocation, storageFake } from "../setup.ts";

const entrypoint = await import("../../entrypoints/content/index.ts");

afterEach(() => {
  hooks.getQuickBlock()?.destroy();
});

const RAIL_SURFACE_SELECTOR = '[data-xb-surface="reply-rail"]';
const LEGACY_SURFACE_SELECTOR =
  '[data-xb-surface="cursor-console"], [data-xb-surface="reply-action-bar"]';

// The post-migration hook names are read through a plain record so this suite
// stays type-checkable against both the pre- and post-migration hook surfaces.
const hookRecord: Record<string, unknown> = hooks;

type RailGetter = () => ReplyRail | null;

function isRailGetter(value: unknown): value is RailGetter {
  return typeof value === "function";
}

function railFromHooks(): ReplyRail | null {
  const getRail = hookRecord["getRail"];
  if (!isRailGetter(getRail)) {
    throw new Error("__xblockerTestHooks.getRail is not installed");
  }
  return getRail();
}

function mountedRail(): ReplyRail {
  const rail = railFromHooks();
  if (!rail) {
    throw new Error("Expected getRail() to return the mounted ReplyRail");
  }
  return rail;
}

function railElement(): HTMLElement | null {
  return document.querySelector(RAIL_SURFACE_SELECTOR);
}

function railElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(RAIL_SURFACE_SELECTOR));
}

function legacyElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(LEGACY_SURFACE_SELECTOR));
}

describe("checkPageAndAddButton", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PL-01 mounts exactly one reply rail and no legacy surfaces on a tweet page", () => {
    setWindowLocation("https://x.com/author/status/123456789");
    hooks.checkPageAndAddButton();
    expect(railElements()).toHaveLength(1);
    expect(legacyElements()).toHaveLength(0);
    expect(railElement()).toBe(mountedRail().root);
  });

  test("PL-02 does not mount on a bare profile page (replies live only on status pages)", () => {
    setWindowLocation("https://x.com/some_profile");
    hooks.checkPageAndAddButton();
    expect(railElements()).toHaveLength(0);
    expect(legacyElements()).toHaveLength(0);
    expect(railFromHooks()).toBeNull();
  });

  test("PL-03 removes a previously mounted rail on the timeline page", () => {
    setWindowLocation("https://x.com/author/status/123456789");
    hooks.checkPageAndAddButton();
    expect(railElements()).toHaveLength(1);

    setWindowLocation("https://x.com/i/timeline");
    hooks.checkPageAndAddButton();
    expect(railElements()).toHaveLength(0);
    expect(legacyElements()).toHaveLength(0);
    expect(railFromHooks()).toBeNull();
  });

  test("PL-04 does not mount on reserved root paths like the home feed", () => {
    // /home, /explore, and /notifications are reserved paths, not profiles.
    for (const path of ["home", "explore", "notifications"]) {
      setWindowLocation(`https://x.com/${path}`);
      hooks.checkPageAndAddButton();
      expect(railElements()).toHaveLength(0);
      expect(legacyElements()).toHaveLength(0);
    }
  });

  test("PL-05 removes the rail on a deep non-profile, non-tweet path", () => {
    setWindowLocation("https://x.com/author/status/123456789");
    hooks.checkPageAndAddButton();
    expect(railElements()).toHaveLength(1);

    setWindowLocation("https://x.com/settings/account");
    hooks.checkPageAndAddButton();
    expect(railElements()).toHaveLength(0);
    expect(legacyElements()).toHaveLength(0);
    expect(railFromHooks()).toBeNull();
  });
});

describe("addButtons", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
  });

  test("PL-06 is idempotent: repeated calls leave exactly one rail", () => {
    hooks.addButtons();
    hooks.addButtons();
    hooks.addButtons();
    expect(railElements()).toHaveLength(1);
    expect(legacyElements()).toHaveLength(0);
  });

  test("PL-07 removes stale legacy containers", () => {
    for (const id of ["xblocker-dashboard", "xblocker-buttons"]) {
      const stale = document.createElement("div");
      stale.id = id;
      document.body.appendChild(stale);
    }
    hooks.addButtons();
    expect(document.getElementById("xblocker-dashboard")).toBeNull();
    expect(document.getElementById("xblocker-buttons")).toBeNull();
    expect(railElements()).toHaveLength(1);
  });

  test("PL-08 forwards document mousemove, scroll, and keydown to the rail exactly once each", () => {
    hooks.addButtons();
    const rail = mountedRail();

    const counts = { keydown: 0, mousemove: 0, scroll: 0 };
    const originalMouseMove = rail.handleMouseMove.bind(rail);
    rail.handleMouseMove = (event: MouseEvent) => {
      counts.mousemove += 1;
      originalMouseMove(event);
    };
    const originalScroll = rail.handleScroll.bind(rail);
    rail.handleScroll = () => {
      counts.scroll += 1;
      originalScroll();
    };
    const originalKeydown = rail.handleKeydown.bind(rail);
    rail.handleKeydown = (event: KeyboardEvent) => {
      counts.keydown += 1;
      originalKeydown(event);
    };

    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 33, clientY: 44 }),
    );
    document.dispatchEvent(new Event("scroll", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(counts).toEqual({ keydown: 1, mousemove: 1, scroll: 1 });
    expect(rail.getState().cursor).toEqual({ x: 33, y: 44 });
  });

  test("PL-22 forwards a real window resize event to the rail, reclamping a docked rail", async () => {
    // Force handleResize's synchronous fallback path (mirrors rail-state.test.ts
    // RS-28) so the clamp lands before we assert, with no rAF flushing needed.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unset window.requestAnimationFrame at runtime, which the DOM typings don't allow.
    const globals = window as unknown as Record<string, unknown>;
    const originalRaf = window.requestAnimationFrame;
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    globals["requestAnimationFrame"] = undefined;
    try {
      storageFake.data["dockPosition"] = { x: 900, y: 200 };
      hooks.addButtons();
      const rail = mountedRail();
      const fakeRect: DOMRect = {
        bottom: 280,
        height: 280,
        left: 0,
        right: 60,
        toJSON: () => ({}),
        top: 0,
        width: 60,
        x: 0,
        y: 0,
      };
      rail.root.getBoundingClientRect = () => fakeRect;
      Object.defineProperty(rail.root, "offsetWidth", { configurable: true, value: 60 });
      Object.defineProperty(rail.root, "offsetHeight", { configurable: true, value: 280 });
      await settleMicrotasks();
      expect(rail.root.style.left).toBe("900px");
      expect(rail.root.style.top).toBe("200px");

      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 500,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 300,
        writable: true,
      });

      // A real dispatched event, not a direct handleResize() call: this fails
      // unless index.ts actually registers a window "resize" listener.
      window.dispatchEvent(new Event("resize"));

      // maxX = max(8, 500 - 60 - 8) = 432; maxY = max(8, 300 - 280 - 8) = 12
      expect(rail.root.style.left).toBe("432px");
      expect(rail.root.style.top).toBe("12px");
    } finally {
      globals["requestAnimationFrame"] = originalRaf;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
        writable: true,
      });
    }
  });
});

describe("observeThemeChanges", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
  });

  test("PL-09 returns a MutationObserver with a disconnect method", () => {
    const observer = hooks.observeThemeChanges();
    expect(typeof observer.disconnect).toBe("function");
    observer.disconnect();
  });

  test("PL-10 re-applies the theme on the rail when html color-scheme flips", async () => {
    hooks.addButtons();
    expect(railElement()?.dataset.xbTheme).toBe("light");

    hooks.observeThemeChanges();
    document.documentElement.style.colorScheme = "dark";
    await settleMicrotasks();

    expect(railElement()?.dataset.xbTheme).toBe("dark");
  });

  test("PL-11 follows body background mutations in both directions", async () => {
    hooks.addButtons();
    hooks.observeThemeChanges();

    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    await settleMicrotasks();
    expect(railElement()?.dataset.xbTheme).toBe("dark");

    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    await settleMicrotasks();
    expect(railElement()?.dataset.xbTheme).toBe("light");
  });

  test("PL-18 replaces the previous observer instead of leaking one per call", () => {
    const first = hooks.observeThemeChanges();
    let disconnects = 0;
    const originalDisconnect = first.disconnect.bind(first);
    first.disconnect = () => {
      disconnects += 1;
      originalDisconnect();
    };

    const second = hooks.observeThemeChanges();
    expect(second).not.toBe(first);
    expect(disconnects).toBe(1);
    second.disconnect();
  });
});

describe("initializeXBlocker", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PL-12 runs the initial page check without throwing", () => {
    setWindowLocation("https://x.com/author/status/123456789");
    expect(() => hooks.initializeXBlocker()).not.toThrow();
    expect(railElements()).toHaveLength(1);
    expect(legacyElements()).toHaveLength(0);
  });

  test("PL-13 mounts the rail when client-side navigation reaches a tweet page", async () => {
    setWindowLocation("https://x.com/settings/account");
    hooks.initializeXBlocker();
    expect(railElement()).toBeNull();

    setWindowLocation("https://x.com/author/status/123456789");
    document.body.appendChild(document.createElement("span"));
    await settleMicrotasks();
    expect(railElements()).toHaveLength(1);
    expect(legacyElements()).toHaveLength(0);

    // A mutation without a URL change must not duplicate the rail.
    document.body.appendChild(document.createElement("span"));
    await settleMicrotasks();
    expect(railElements()).toHaveLength(1);
  });

  test("PL-14 removes the rail when client-side navigation reaches the timeline", async () => {
    setWindowLocation("https://x.com/author/status/123456789");
    hooks.initializeXBlocker();
    expect(railElements()).toHaveLength(1);

    setWindowLocation("https://x.com/i/timeline");
    document.body.appendChild(document.createElement("span"));
    await settleMicrotasks();
    expect(railElements()).toHaveLength(0);
    expect(railFromHooks()).toBeNull();
  });

  test("PL-19 destroys the old rail and mounts a fresh one across SPA navigations", async () => {
    setWindowLocation("https://x.com/author/status/123456789");
    hooks.initializeXBlocker();
    const first = mountedRail();
    let destroys = 0;
    const originalDestroy = first.destroy.bind(first);
    first.destroy = () => {
      destroys += 1;
      originalDestroy();
    };

    setWindowLocation("https://x.com/i/timeline");
    document.body.appendChild(document.createElement("span"));
    await settleMicrotasks();
    expect(destroys).toBe(1);
    expect(railFromHooks()).toBeNull();
    expect(railElements()).toHaveLength(0);

    setWindowLocation("https://x.com/another/status/987654321");
    document.body.appendChild(document.createElement("span"));
    await settleMicrotasks();
    const second = mountedRail();
    expect(second).not.toBe(first);
    expect(second.root.isConnected).toBe(true);
    expect(railElements()).toHaveLength(1);
  });
});

describe("runContentScript", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
  });

  test("PL-15 no-ops while the __XB_TEST__ flag is truthy", () => {
    globalThis.__XB_TEST__ = true;
    try {
      hooks.runContentScript();
      expect(railElement()).toBeNull();
      expect(legacyElements()).toHaveLength(0);
    } finally {
      globalThis.__XB_TEST__ = undefined;
    }
  });

  test("PL-16 initializes outside test mode", () => {
    globalThis.__XB_TEST__ = undefined;
    expect(() => hooks.runContentScript()).not.toThrow();
    expect(railElements()).toHaveLength(1);
    expect(legacyElements()).toHaveLength(0);
  });

  test("PL-17 the default export main delegates to runContentScript", () => {
    expect(typeof entrypoint.default.main).toBe("function");

    globalThis.__XB_TEST__ = undefined;
    try {
      // main() ignores its ctx in this entrypoint; `undefined!` keeps the dummy
      // ctx type-safe without constructing a real ContentScriptContext.
      void entrypoint.default.main(undefined!);
    } finally {
      globalThis.__XB_TEST__ = undefined;
    }
    expect(railElements()).toHaveLength(1);
    expect(legacyElements()).toHaveLength(0);
  });
});

describe("test hook surface", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PL-20 exposes getRail, computeRailY, and railTimings", () => {
    expect(isRailGetter(hookRecord["getRail"])).toBe(true);
    expect(hookRecord["computeRailY"]).toBe(computeRailY);
    expect(hookRecord["railTimings"]).toEqual({
      dwellMs: DWELL_MS,
      collapseGraceMs: COLLAPSE_GRACE_MS,
    });
  });

  test("PL-21 no longer exposes the cursor-console and dock hooks", () => {
    for (const legacy of [
      "computeConsolePosition",
      "consoleGraceMs",
      "getCursorConsole",
      "getDock",
    ]) {
      expect(legacy in hookRecord).toBe(false);
    }
  });
});
