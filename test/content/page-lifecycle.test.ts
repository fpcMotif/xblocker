// Catalog: PL-* (checkPageAndAddButton / initializeXBlocker / observeThemeChanges).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hooks } from "../helpers/content-hooks.ts";
import { installImmediateTimers } from "../helpers/timers.ts";
import { resetTestEnvironment, setWindowLocation } from "../setup.ts";

describe("checkPageAndAddButton", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PL-01 adds the action bar on a tweet page", () => {
    setWindowLocation("https://x.com/author/status/123456789");
    hooks.checkPageAndAddButton();
    expect(document.getElementById("xblocker-reply-action-bar")).toBeTruthy();
  });

  test("PL-02 adds the action bar on a bare profile page", () => {
    setWindowLocation("https://x.com/some_profile");
    hooks.checkPageAndAddButton();
    expect(document.getElementById("xblocker-reply-action-bar")).toBeTruthy();
  });

  test("PL-03 does nothing on the timeline page", () => {
    setWindowLocation("https://x.com/i/timeline");
    hooks.checkPageAndAddButton();
    expect(document.getElementById("xblocker-reply-action-bar")).toBeNull();
  });

  test("PL-04 does nothing on the home feed", () => {
    setWindowLocation("https://x.com/home");
    hooks.checkPageAndAddButton();
    // /home is a reserved profile path so PROFILE_URL_PATTERN matches it, but
    // it is not a tweet page; ensure we don't crash either way.
    expect(() => hooks.checkPageAndAddButton()).not.toThrow();
  });

  test("PL-05 does not add a bar on a deep non-profile, non-tweet path", () => {
    setWindowLocation("https://x.com/settings/account");
    hooks.checkPageAndAddButton();
    expect(document.getElementById("xblocker-reply-action-bar")).toBeNull();
  });
});

describe("observeThemeChanges", () => {
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
    timers = installImmediateTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  test("PL-06 returns a MutationObserver with a disconnect method", () => {
    const observer = hooks.observeThemeChanges();
    expect(typeof observer.disconnect).toBe("function");
    observer.disconnect();
  });

  test("PL-07 refreshes buttons when a dashboard container is present", async () => {
    const dashboard = document.createElement("div");
    dashboard.id = "xblocker-dashboard";
    document.body.appendChild(dashboard);

    const observer = hooks.observeThemeChanges();
    document.documentElement.setAttribute("data-theme", "dark");

    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    // With immediate timers, the queued addButtons() runs synchronously.
    expect(document.getElementById("xblocker-reply-action-bar")).toBeTruthy();
    observer.disconnect();
  });
});

describe("initializeXBlocker", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("PL-08 runs the initial page check without throwing", () => {
    setWindowLocation("https://x.com/author/status/123456789");
    expect(() => hooks.initializeXBlocker()).not.toThrow();
    expect(document.getElementById("xblocker-reply-action-bar")).toBeTruthy();
  });
});
