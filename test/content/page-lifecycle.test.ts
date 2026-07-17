// Catalog: PL-* (ContentSession lifecycle and content-script bootstrap).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  ContentSession,
  type ContentSessionDeps,
} from "../../entrypoints/content/content-session.ts";
import type {
  CreateQuickBlockServiceOptions,
  QuickBlockService,
} from "../../entrypoints/content/create-quick-block-service.ts";
import { ReplyRail } from "../../entrypoints/content/rail.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, setWindowLocation } from "../setup.ts";

const RAIL_SELECTOR = '[data-xb-surface="reply-rail"]';
const LEGACY_SELECTOR = '[data-xb-surface="cursor-console"], [data-xb-surface="reply-action-bar"]';

type Harness = {
  location: { href: string; hostname: string };
  navigate(): void;
  observerDisconnects: () => number;
  quickBlock: { destroys: number; mounts: number };
  rails: ReplyRail[];
  session: ContentSession;
};

function makeHarness(url = "https://x.com/author/status/123456789"): Harness {
  const location = { href: url, hostname: "x.com" };
  const rails: ReplyRail[] = [];
  const quickBlock = { destroys: 0, mounts: 0 };
  let navigate = (): void => undefined;
  let observerDisconnects = 0;

  const deps: ContentSessionDeps = {
    location,
    createQuickBlockService(_options: CreateQuickBlockServiceOptions): QuickBlockService {
      return {
        destroy() {
          quickBlock.destroys += 1;
        },
        mount() {
          quickBlock.mounts += 1;
        },
      };
    },
    createRail() {
      const rail = new ReplyRail();
      rails.push(rail);
      return rail;
    },
    resolveQuickBlockMode: () => "inline",
    observeUrlChanges(onChange) {
      navigate = onChange;
      return {
        disconnect() {
          observerDisconnects += 1;
        },
      };
    },
  };

  return {
    location,
    navigate: () => navigate(),
    observerDisconnects: () => observerDisconnects,
    quickBlock,
    rails,
    session: new ContentSession(deps),
  };
}

let sessions: ContentSession[] = [];

beforeEach(() => {
  resetTestEnvironment();
  setWindowLocation("https://x.com/author/status/123456789");
});

afterEach(() => {
  for (const session of sessions) {
    session.destroy();
  }
  sessions = [];
});

function track(harness: Harness): Harness {
  sessions.push(harness.session);
  return harness;
}

function railElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(RAIL_SELECTOR));
}

describe("ContentSession navigation", () => {
  test("PL-01 start mounts one rail and one session-long quick-block service", () => {
    const harness = track(makeHarness());
    harness.session.start();
    harness.session.start();

    expect(railElements()).toHaveLength(1);
    expect(document.querySelectorAll(LEGACY_SELECTOR)).toHaveLength(0);
    expect(harness.rails).toHaveLength(1);
    expect(harness.quickBlock.mounts).toBe(1);
  });

  test("PL-02 non-status pages do not mount a rail", () => {
    for (const path of ["some_profile", "home", "explore", "notifications", "settings/account"]) {
      const harness = track(makeHarness(`https://x.com/${path}`));
      harness.session.start();
      expect(railElements()).toHaveLength(0);
      harness.session.destroy();
    }
  });

  test("PL-03 navigation removes the rail but keeps quick-block alive", () => {
    const harness = track(makeHarness());
    harness.session.start();

    harness.location.href = "https://x.com/i/timeline";
    harness.navigate();

    expect(railElements()).toHaveLength(0);
    expect(harness.quickBlock.destroys).toBe(0);
  });

  test("PL-06 repeated status handling leaves one fresh rail", () => {
    const harness = track(makeHarness());
    harness.session.start();
    const first = harness.rails[0];

    harness.session.handleNavigation("https://x.com/another/status/987654321");
    harness.session.handleNavigation("https://x.com/third/status/555555555");

    expect(harness.rails).toHaveLength(3);
    expect(first?.root.isConnected).toBe(false);
    expect(railElements()).toHaveLength(1);
  });

  test("PL-07 status mount removes stale legacy containers", () => {
    for (const id of ["xblocker-dashboard", "xblocker-buttons"]) {
      const stale = document.createElement("div");
      stale.id = id;
      document.body.appendChild(stale);
    }

    const harness = track(makeHarness());
    harness.session.start();

    expect(document.getElementById("xblocker-dashboard")).toBeNull();
    expect(document.getElementById("xblocker-buttons")).toBeNull();
  });

  test("PL-19 SPA status navigation destroys the old rail and mounts a new one", () => {
    const harness = track(makeHarness());
    harness.session.start();
    const first = harness.rails[0];

    harness.location.href = "https://x.com/i/timeline";
    harness.navigate();
    harness.location.href = "https://x.com/another/status/987654321";
    harness.navigate();

    expect(first?.root.isConnected).toBe(false);
    expect(harness.rails[1]?.root.isConnected).toBe(true);
    expect(railElements()).toHaveLength(1);
  });
});

describe("ContentSession listeners and cleanup", () => {
  test("PL-08 forwards global input to the current rail", () => {
    const harness = track(makeHarness());
    harness.session.start();
    const rail = harness.rails[0];
    if (!rail) {
      throw new Error("expected mounted rail");
    }

    const counts = { keydown: 0, mousemove: 0, resize: 0, scroll: 0 };
    rail.handleMouseMove = () => {
      counts.mousemove += 1;
    };
    rail.handleScroll = () => {
      counts.scroll += 1;
    };
    rail.handleResize = () => {
      counts.resize += 1;
    };
    rail.handleKeydown = () => {
      counts.keydown += 1;
    };

    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new Event("scroll", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    window.dispatchEvent(new Event("resize"));

    expect(counts).toEqual({ keydown: 1, mousemove: 1, resize: 1, scroll: 1 });
  });

  test("PL-10 keeps a mounted rail in sync with page theme", async () => {
    const harness = track(makeHarness());
    harness.session.start();
    expect(document.querySelector<HTMLElement>(RAIL_SELECTOR)?.dataset.xbTheme).toBe("light");

    document.documentElement.style.colorScheme = "dark";
    await settleMicrotasks();

    expect(document.querySelector<HTMLElement>(RAIL_SELECTOR)?.dataset.xbTheme).toBe("dark");
  });

  test("PL-23 destroy tears down surfaces, observers, and global listeners", () => {
    const harness = track(makeHarness());
    harness.session.start();
    const rail = harness.rails[0];
    if (!rail) {
      throw new Error("expected mounted rail");
    }
    let mouseMoves = 0;
    rail.handleMouseMove = () => {
      mouseMoves += 1;
    };

    harness.session.destroy();
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(mouseMoves).toBe(0);
    expect(rail.root.isConnected).toBe(false);
    expect(harness.quickBlock.destroys).toBe(1);
    expect(harness.observerDisconnects()).toBe(1);
  });
});

describe("content-script bootstrap", () => {
  test("PL-17 default main starts a ContentSession", async () => {
    const startDescriptor = Object.getOwnPropertyDescriptor(ContentSession.prototype, "start");
    if (!startDescriptor) {
      throw new Error("expected ContentSession.start");
    }
    let starts = 0;
    Object.defineProperty(ContentSession.prototype, "start", {
      ...startDescriptor,
      value: () => {
        starts += 1;
      },
    });
    try {
      const entrypoint = await import("../../entrypoints/content/index.ts");
      void entrypoint.default.main(undefined!);
    } finally {
      Object.defineProperty(ContentSession.prototype, "start", startDescriptor);
    }
    expect(starts).toBe(1);
  });
});
