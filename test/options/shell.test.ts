// Catalog: OS-* (options page shell: rail, hash routing, version footer, mount guard).
// The "cloud" route is deliberately NOT exercised here — rendering it triggers cloud.ts's
// lazy `import("../../lib/convex-sync")`, and this file must never cause the REAL
// convex-sync module (live deployment URL, real HTTP client) to load in tests.
// cloud.test.ts injects the pane's cloud ports and is the one place that exercises that
// route, including through this same shell (via renderOptions' `cloud` opt).
import { beforeEach, describe, expect, test } from "bun:test";

import { mountOptionsIfPresent, renderOptions } from "../../entrypoints/options/main.ts";
import { WHITELIST_KEY } from "../../entrypoints/lib/chrome-storage.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

function navLink(route: string): HTMLAnchorElement {
  const link = document.querySelector<HTMLAnchorElement>(`.xb-opt-nav-item[data-route="${route}"]`);
  if (!link) throw new Error(`nav link for "${route}" not found`);
  return link;
}

function clickNav(route: string): void {
  navLink(route).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function contentPane(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".xb-opt-content");
  if (!el) throw new Error("content pane not found");
  return el;
}

function activeRoute(): string | undefined {
  const active = document.querySelector<HTMLAnchorElement>('.xb-opt-nav-item[aria-current="page"]');
  return active?.dataset["route"];
}

describe("options shell", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OS-01 renders the rail (brand + 5 nav items) with General active by default", async () => {
    await renderOptions(document.body);

    expect(document.querySelector(".xb-opt-brand-name")?.textContent).toBe("XBlocker");
    expect(
      Array.from(document.querySelectorAll<HTMLElement>(".xb-opt-nav-item")).map(
        (el) => el.dataset["route"],
      ),
    ).toEqual(["general", "whitelist", "blocked-log", "cloud", "about"]);
    expect(activeRoute()).toBe("general");
    expect(contentPane().querySelector("h1")?.textContent).toBe("General");
  });

  test("OS-02 injects the stylesheet exactly once across renders", async () => {
    await renderOptions(document.body);
    await renderOptions(document.body);
    expect(document.querySelectorAll("#xblocker-options-styles")).toHaveLength(1);
  });

  test("OS-03 replaces the whole shell on re-render (no duplicate roots)", async () => {
    await renderOptions(document.body);
    await renderOptions(document.body);
    expect(document.querySelectorAll(".xb-opt-root")).toHaveLength(1);
  });

  test("OS-04 clicking a nav item switches the pane, updates aria-current and the URL hash", async () => {
    await renderOptions(document.body);

    clickNav("whitelist");
    await settleMicrotasks();
    expect(activeRoute()).toBe("whitelist");
    expect(contentPane().querySelector("h1")?.textContent).toBe("Whitelist");
    expect(window.location.hash).toBe("#whitelist");

    clickNav("blocked-log");
    await settleMicrotasks();
    expect(activeRoute()).toBe("blocked-log");
    expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");

    clickNav("about");
    await settleMicrotasks();
    expect(activeRoute()).toBe("about");
    expect(contentPane().querySelector("h1")?.textContent).toBe("About");

    clickNav("general");
    await settleMicrotasks();
    expect(activeRoute()).toBe("general");
    expect(contentPane().querySelector("h1")?.textContent).toBe("General");
  });

  test("OS-05 an initial #whitelist hash deep-links straight to that pane", async () => {
    window.location.hash = "#whitelist";
    await renderOptions(document.body);
    expect(activeRoute()).toBe("whitelist");
    expect(contentPane().querySelector("h1")?.textContent).toBe("Whitelist");
  });

  test("OS-06 an unrecognized hash falls back to General", async () => {
    window.location.hash = "#not-a-real-route";
    await renderOptions(document.body);
    expect(activeRoute()).toBe("general");
    expect(contentPane().querySelector("h1")?.textContent).toBe("General");
  });

  test("OS-07 clicking the already-active nav item is a no-op", async () => {
    await renderOptions(document.body);
    expect(() => clickNav("general")).not.toThrow();
    await settleMicrotasks();
    expect(activeRoute()).toBe("general");
    expect(document.querySelectorAll(".xb-opt-content h1")).toHaveLength(1);
  });

  test("OS-08 navigating away unsubscribes the outgoing pane's storage watcher", async () => {
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
      await renderOptions(document.body);
      // General's pane subscribes exactly one settings-change listener on mount.
      expect(listeners).toHaveLength(1);

      clickNav("whitelist");
      await settleMicrotasks();
      expect(listeners).toHaveLength(0);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
    }
  });

  test("OS-09 the pinned version reads chrome.runtime.getManifest when present, and is blank otherwise", async () => {
    await renderOptions(document.body);
    expect(document.querySelector(".xb-opt-version")?.textContent).toBe("");

    (chrome.runtime as { getManifest?: () => { version: string } }).getManifest = () => ({
      version: "9.9.9",
    });
    try {
      await renderOptions(document.body);
      expect(document.querySelector(".xb-opt-version")?.textContent).toBe("v9.9.9");
    } finally {
      delete (chrome.runtime as { getManifest?: () => { version: string } }).getManifest;
    }
  });

  test("OS-10 a second navigation started before the first resolves wins; the stale pane never lands in the DOM", async () => {
    await renderOptions(document.body);

    clickNav("whitelist");
    clickNav("blocked-log");
    await settleMicrotasks();

    expect(activeRoute()).toBe("blocked-log");
    expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");
    expect(document.querySelectorAll(".xb-opt-content h1")).toHaveLength(1);
  });

  test("OS-13 a superseded navigation that finishes loading late must never overwrite the winning pane's DOM", async () => {
    await renderOptions(document.body);

    // Hold back whitelist's WHITELIST_KEY read so its navigation is still in flight
    // (mid-Promise.all) when a second, faster navigation completes and wins.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reinstalling chrome.storage.local.get as a runtime interceptor the static chrome typings don't model.
    const storageLocal = chrome.storage.local as unknown as Record<string, unknown>;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same runtime-interceptor cast as above, narrowed to the get() signature.
    const originalGet = storageLocal["get"] as (
      keys: unknown,
      callback: (items?: Record<string, unknown>) => void,
    ) => void;
    let releaseWhitelistGet: (() => void) | undefined;
    storageLocal["get"] = (keys: unknown, callback: (items?: Record<string, unknown>) => void) => {
      if (keys === WHITELIST_KEY) {
        releaseWhitelistGet = () => originalGet(keys, callback);
        return;
      }
      originalGet(keys, callback);
    };

    try {
      clickNav("whitelist"); // starts loading; its WHITELIST_KEY read is held back indefinitely
      await settleMicrotasks();

      clickNav("blocked-log"); // a newer navigation that fully resolves before whitelist's held read fires
      await settleMicrotasks();

      expect(activeRoute()).toBe("blocked-log");
      expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");

      releaseWhitelistGet?.();
      await settleMicrotasks();

      // The stale whitelist navigation resolving after the fact must not clobber the
      // pane that already won — it never reached `content` at all.
      expect(activeRoute()).toBe("blocked-log");
      expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");
      expect(document.querySelectorAll(".xb-opt-content h1")).toHaveLength(1);
    } finally {
      storageLocal["get"] = originalGet;
    }
  });

  test("OS-14 a pane whose loader rejects shows an inline error state, and clicking its nav item again retries", async () => {
    await renderOptions(document.body);

    // blockedStore.list()'s underlying read rejects (rather than degrading to undefined)
    // on a failed chrome.storage.local.get — see blocked-store.ts's readKey.
    storageFake.failNextGet = true;
    clickNav("blocked-log");
    await settleMicrotasks();

    expect(activeRoute()).toBe("blocked-log");
    expect(contentPane().querySelector("h1")).toBeNull();
    expect(contentPane().textContent).toContain("Couldn't load this page.");
    const retryLink = contentPane().querySelector<HTMLAnchorElement>(".xb-opt-link-row");
    expect(retryLink?.textContent).toBe("Try again");

    // Re-entry guard must be reset: navigating to the same route again is not a no-op.
    clickNav("blocked-log");
    await settleMicrotasks();

    expect(activeRoute()).toBe("blocked-log");
    expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");
  });

  test("OS-15 the error state's retry link re-navigates to the same route", async () => {
    await renderOptions(document.body);

    storageFake.failNextGet = true;
    clickNav("blocked-log");
    await settleMicrotasks();

    contentPane()
      .querySelector<HTMLAnchorElement>(".xb-opt-link-row")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settleMicrotasks();

    expect(activeRoute()).toBe("blocked-log");
    expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");
  });

  test("OS-16 a rapid double-navigate away from a pane ends on the final route with the earlier pane's listeners torn down", async () => {
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
      await renderOptions(document.body);
      // General's pane subscribes exactly one settings-change listener on mount.
      expect(listeners).toHaveLength(1);

      clickNav("whitelist");
      clickNav("blocked-log");
      await settleMicrotasks();

      expect(activeRoute()).toBe("blocked-log");
      expect(contentPane().querySelector("h1")?.textContent).toBe("Blocked log");
      expect(document.querySelectorAll(".xb-opt-content h1")).toHaveLength(1);
      // The pane mounted before this double-navigate (General) is fully torn down.
      expect(listeners).toHaveLength(0);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
    }
  });
});

describe("mountOptionsIfPresent", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OS-11 auto-renders into #app when present", async () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);

    mountOptionsIfPresent();
    await settleMicrotasks();

    expect(app.querySelector(".xb-opt-root")).toBeTruthy();
  });

  test("OS-12 does nothing when #app is absent", () => {
    expect(() => mountOptionsIfPresent()).not.toThrow();
    expect(document.querySelector(".xb-opt-root")).toBeNull();
  });
});
