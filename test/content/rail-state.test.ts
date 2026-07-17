// Catalog: RS-* (ReplyRail state machine: collapsed/tracking/settled
// transitions, Glide motion, dwell + collapse-grace timing, suppression,
// and batch pinning).
//
// This suite drives the rail through its public handlers.
// Spec: docs/superpowers/specs/2026-06-12-reply-rail-design.md
// §§ States, Motion, Reply-mode detection.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { batchState } from "../../entrypoints/content/reply-actions.ts";
import { FOLLOW_FACTOR, lerp, VIEWPORT_MARGIN } from "../../entrypoints/content/position.ts";
import { COLLAPSE_GRACE_MS, DWELL_MS, ReplyRail } from "../../entrypoints/content/rail.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../setup.ts";

// Deterministic clock origin for step(nowMs); any test that advances time
// derives from this so dwell math is explicit.
const T0 = 100_000;

// The rail's measured height is stubbed to a fixed value so the centering
// math computeRailY(cursorY) = clamp(cursorY - RAIL_HEIGHT / 2, ...) is exact.
const RAIL_HEIGHT = 280;
const RAIL_WIDTH = 60;

let rail: ReplyRail | null = null;
let timers: FakeTimers | null = null;
let viewportOverridden = false;
const DEFAULT_VIEWPORT_HEIGHT = window.innerHeight;
const DEFAULT_VIEWPORT_WIDTH = window.innerWidth;

// --- timers -----------------------------------------------------------------
// Local fake timers instead of test/helpers/timers.ts: ManualTimers does not
// intercept clearTimeout, so a cancelled collapse-grace timer (RS-09) would
// still fire on flush. This fake removes cleared timers from the queue.
type FakeTimers = {
  flush: () => void;
  flushUpTo: (maxDelay: number) => void;
  pendingDelays: () => number[];
  uninstall: () => void;
};

function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const globals = globalThis as Record<string, unknown>;
  type QueuedTimer = { id: number; callback: () => void; delay: number };
  const queue: QueuedTimer[] = [];
  let nextId = 1;

  globals["setTimeout"] = (callback: () => void, delay?: number) => {
    const id = nextId++;
    queue.push({ id, callback, delay: delay ?? 0 });
    return id;
  };
  globals["clearTimeout"] = (id?: unknown) => {
    const index = queue.findIndex((timer) => timer.id === id);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  };

  return {
    flush() {
      while (queue.length > 0) {
        const next = queue.shift();
        next?.callback();
      }
    },
    flushUpTo(maxDelay: number) {
      const runnable = queue.filter((timer) => timer.delay <= maxDelay);
      for (const timer of runnable) {
        const index = queue.indexOf(timer);
        if (index !== -1) {
          queue.splice(index, 1);
        }
        timer.callback();
      }
    },
    pendingDelays: () => queue.map((timer) => timer.delay),
    uninstall() {
      globals["setTimeout"] = originalSetTimeout;
      globals["clearTimeout"] = originalClearTimeout;
    },
  };
}

// --- DOM fixtures -------------------------------------------------------------

function createTweetArticle(username: string): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  const link = document.createElement("a");
  link.setAttribute("href", `/${username}/status/123456789`);
  link.setAttribute("role", "link");
  article.appendChild(link);
  return article;
}

/** Append the main tweet (first article, excluded by isReplyArticle). */
function mountMainTweet(): HTMLElement {
  const main = createTweetArticle("thread_author");
  document.body.appendChild(main);
  return main;
}

/** Append main tweet + one reply article; returns the reply. */
function mountReply(username = "alice"): HTMLElement {
  mountMainTweet();
  const reply = createTweetArticle(username);
  document.body.appendChild(reply);
  return reply;
}

// --- rail harness -------------------------------------------------------------

/** Pin the rail's measured size so motion targets are deterministic. */
function stubRailSize(root: HTMLElement): void {
  const fakeRect: DOMRect = {
    bottom: RAIL_HEIGHT,
    height: RAIL_HEIGHT,
    left: 0,
    right: RAIL_WIDTH,
    toJSON: () => ({}),
    top: 0,
    width: RAIL_WIDTH,
    x: 0,
    y: 0,
  };
  root.getBoundingClientRect = () => fakeRect;
  Object.defineProperty(root, "offsetWidth", { configurable: true, value: RAIL_WIDTH });
  Object.defineProperty(root, "offsetHeight", { configurable: true, value: RAIL_HEIGHT });
}

function setupRail(): ReplyRail {
  const instance = new ReplyRail();
  stubRailSize(instance.root);
  instance.mount();
  rail = instance;
  return instance;
}

/** What computeRailY must produce for the stubbed rail in this viewport. */
function expectedRailY(cursorY: number): number {
  const min = VIEWPORT_MARGIN;
  const max = Math.max(min, (window.innerHeight || 0) - RAIL_HEIGHT - VIEWPORT_MARGIN);
  return Math.min(Math.max(cursorY - RAIL_HEIGHT / 2, min), max);
}

function setViewportHeight(height: number): void {
  viewportOverridden = true;
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
    writable: true,
  });
}

function setViewportWidth(width: number): void {
  viewportOverridden = true;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
}

/** Dispatch a mousemove on `target` and feed the same event to the rail. */
function moveOver(instance: ReplyRail, target: Element, x: number, y: number): void {
  const event = new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  instance.handleMouseMove(event);
}

function pressKey(instance: ReplyRail, key: string): void {
  instance.handleKeydown(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/** A MouseEvent standing in for a PointerEvent (happy-dom has no PointerEvent
 *  constructor); rail.ts only reads clientX/clientY/pointerId off the event. */
function pointerEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
}

function getPuck(instance: ReplyRail): HTMLButtonElement {
  const puck = instance.root.querySelector<HTMLButtonElement>(".xb-puck");
  if (!puck) {
    throw new Error("puck missing");
  }
  return puck;
}

/** Track, then settle by dwell: anchor at t0, settle at t0 + DWELL_MS. */
function settleByDwell(
  instance: ReplyRail,
  target: Element,
  x: number,
  y: number,
  t0 = T0,
): number {
  moveOver(instance, target, x, y);
  expect(instance.getState().state).toBe("tracking");
  instance.step(t0);
  instance.step(t0 + DWELL_MS);
  expect(instance.getState().state).toBe("settled");
  return t0 + DWELL_MS;
}

describe("ReplyRail state machine", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  afterEach(() => {
    rail?.destroy();
    rail = null;
    timers?.uninstall();
    timers = null;
    batchState.running = false;
    if (viewportOverridden) {
      setViewportHeight(DEFAULT_VIEWPORT_HEIGHT);
      setViewportWidth(DEFAULT_VIEWPORT_WIDTH);
      viewportOverridden = false;
    }
  });

  test("RS-01 a mounted rail starts collapsed showing the session puck", () => {
    const instance = setupRail();

    expect(instance.root.dataset["xbSurface"]).toBe("reply-rail");
    expect(document.querySelector('[data-xb-surface="reply-rail"]')).toBe(instance.root);
    expect(instance.getState().state).toBe("collapsed");
    expect(instance.root.dataset["state"]).toBe("collapsed");

    // The collapsed surface is a single puck carrying the session count; both
    // the drag affordance and the expanded body remain in the DOM (which
    // surface shows is CSS keyed off [data-state="collapsed"]).
    const puck = instance.root.querySelector<HTMLElement>(".xb-puck");
    expect(puck).not.toBeNull();
    expect(puck?.getAttribute("aria-label")).toBe("XBlocker — 0 blocked this session");
    expect(instance.root.querySelector<HTMLElement>(".xb-puck-count")?.hidden).toBe(true);
    expect(instance.root.querySelector('[data-action="drag"]')).not.toBeNull();
  });

  test("RS-22 the puck badge reveals the session count and updates its aria-label", () => {
    const instance = setupRail();
    const puck = instance.root.querySelector<HTMLElement>(".xb-puck");
    const badge = instance.root.querySelector<HTMLElement>(".xb-puck-count");
    expect(badge?.hidden).toBe(true);

    instance.incrementBlocked(3);

    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe("3");
    expect(puck?.getAttribute("aria-label")).toBe("XBlocker — 3 blocked this session");
  });

  test("RS-23 entering the reply region flips the rail off the collapsed surface", () => {
    const instance = setupRail();
    const reply = mountReply("alice");
    expect(instance.root.dataset["state"]).toBe("collapsed");

    moveOver(instance, reply, 300, 400);

    expect(instance.getState().state).toBe("tracking");
    expect(instance.root.dataset["state"]).toBe("tracking");
    expect(instance.root.querySelector(".xb-rail-body")).not.toBeNull();
  });

  test("RS-02 destroy() removes the rail root from the document", () => {
    const instance = setupRail();
    expect(instance.root.isConnected).toBe(true);

    instance.destroy();

    expect(instance.root.isConnected).toBe(false);
    expect(document.querySelector('[data-xb-surface="reply-rail"]')).toBeNull();
  });

  test("RS-03 mousemove inside a reply article expands the rail to tracking", () => {
    const instance = setupRail();
    const reply = mountReply("alice");
    const link = reply.querySelector('a[role="link"]');
    if (!link) {
      throw new Error("reply author link missing");
    }

    moveOver(instance, link, 300, 400);

    expect(instance.getState().state).toBe("tracking");
    expect(instance.root.dataset["state"]).toBe("tracking");
    expect(instance.getState().cursor).toEqual({ x: 300, y: 400 });
  });

  test("RS-04 step() glides rendered Y toward the cursor target while X stays home", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    instance.step(T0);
    moveOver(instance, reply, 300, 700);

    const target = expectedRailY(700); // clamp(700 - 140, 8, 768 - 280 - 8) = 480
    const before = instance.getState().rendered;
    instance.step(T0 + 16);
    const after = instance.getState().rendered;

    expect(instance.getState().state).toBe("tracking");
    expect(after.y).toBeCloseTo(lerp(before.y, target, FOLLOW_FACTOR), 6);
    expect(Math.abs(target - after.y)).toBeLessThan(Math.abs(target - before.y));
    expect(after.x).toBe(before.x);

    // The damping is per-frame: the next step lerps from the new position.
    instance.step(T0 + 32);
    expect(instance.getState().rendered.y).toBeCloseTo(lerp(after.y, target, FOLLOW_FACTOR), 6);
  });

  test("RS-05 a stationary cursor settles after DWELL_MS and freezes rendered Y", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    instance.step(T0);
    expect(instance.getState().state).toBe("tracking");

    instance.step(T0 + DWELL_MS);

    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled"); // settled lock cue

    const frozenY = instance.getState().rendered.y;
    instance.step(T0 + DWELL_MS + 16);
    instance.step(T0 + DWELL_MS + 500);
    expect(instance.getState().rendered.y).toBe(frozenY);
  });

  test("RS-06 sub-jitter movement does not reset the dwell timer", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    instance.step(T0);
    moveOver(instance, reply, 303, 400); // 3px < the 4px jitter threshold

    instance.step(T0 + DWELL_MS);

    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");
  });

  test("RS-07 movement beyond the jitter threshold re-anchors the dwell timer", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    instance.step(T0);
    moveOver(instance, reply, 300, 450); // 50px > jitter: dwell restarts

    instance.step(T0 + DWELL_MS);
    expect(instance.getState().state).toBe("tracking");

    // The new anchor is the first step that observed the move.
    instance.step(T0 + 2 * DWELL_MS);
    expect(instance.getState().state).toBe("settled");
  });

  test("RS-08 leaving replies and rail settles immediately, then collapses after the grace", () => {
    timers = installFakeTimers();
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    expect(instance.getState().state).toBe("tracking");

    moveOver(instance, document.body, 600, 500);

    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");
    expect(timers.pendingDelays()).toContain(COLLAPSE_GRACE_MS);

    timers.flushUpTo(COLLAPSE_GRACE_MS);

    expect(instance.getState().state).toBe("collapsed");
    expect(instance.root.dataset["state"]).toBe("collapsed");
  });

  test("RS-09 hovering the rail cancels the pending collapse and stays settled", () => {
    timers = installFakeTimers();
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    moveOver(instance, document.body, 600, 500);
    expect(instance.getState().state).toBe("settled");
    expect(timers.pendingDelays()).toContain(COLLAPSE_GRACE_MS);

    moveOver(instance, instance.root, 900, 300);

    timers.flush(); // a cancelled grace timer must not collapse the rail
    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");
  });

  test("RS-10 movement beyond the jitter threshold inside replies resumes tracking from settled", () => {
    const instance = setupRail();
    const reply = mountReply("alice");
    settleByDwell(instance, reply, 300, 400);

    moveOver(instance, reply, 300, 450); // 50px > jitter

    expect(instance.getState().state).toBe("tracking");
    expect(instance.root.dataset["state"]).toBe("tracking");
  });

  test("RS-11 sub-jitter movement while settled keeps the rail settled", () => {
    const instance = setupRail();
    const reply = mountReply("alice");
    settleByDwell(instance, reply, 300, 400);

    moveOver(instance, reply, 302, 401); // ~2.2px < jitter

    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");
  });

  test("RS-12 Escape collapses from tracking; other keys are ignored", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    pressKey(instance, "a");
    expect(instance.getState().state).toBe("tracking");

    pressKey(instance, "Escape");

    expect(instance.getState().state).toBe("collapsed");
    expect(instance.root.dataset["state"]).toBe("collapsed");
  });

  test("RS-13 Escape collapses from settled", () => {
    const instance = setupRail();
    const reply = mountReply("alice");
    settleByDwell(instance, reply, 300, 400);

    pressKey(instance, "Escape");

    expect(instance.getState().state).toBe("collapsed");
    expect(instance.root.dataset["state"]).toBe("collapsed");
  });

  test("RS-14 inputs, textareas, and contenteditables suppress the rail", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, textarea, editable);

    for (const suppressor of [input, textarea, editable]) {
      moveOver(instance, reply, 300, 400);
      expect(instance.getState().state).toBe("tracking");

      moveOver(instance, suppressor, 310, 410);

      expect(instance.getState().state).toBe("collapsed");
      expect(instance.root.dataset["state"]).toBe("collapsed");
    }
  });

  test("RS-15 an open aria-modal dialog keeps the rail collapsed until it closes", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    expect(instance.getState().state).toBe("tracking");

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    moveOver(instance, reply, 305, 405);
    expect(instance.getState().state).toBe("collapsed");

    moveOver(instance, reply, 320, 430); // stays collapsed while the modal is open
    expect(instance.getState().state).toBe("collapsed");

    dialog.remove();
    moveOver(instance, reply, 340, 450);
    expect(instance.getState().state).toBe("tracking");
  });

  test("RS-16 the main tweet article never expands the rail", () => {
    const instance = setupRail();
    mountReply("alice");
    const main = document.querySelector('article[data-testid="tweet"]');
    if (!(main instanceof HTMLElement)) {
      throw new Error("main tweet article missing");
    }

    moveOver(instance, main, 300, 200);

    expect(instance.getState().state).toBe("collapsed");
    expect(instance.root.dataset["state"]).toBe("collapsed");
  });

  test("RS-17 scroll keeps the settled state and the next step() re-clamps Y into the viewport", () => {
    const instance = setupRail();
    const reply = mountReply("alice");
    const settledAt = settleByDwell(instance, reply, 300, 700);

    setViewportHeight(300);
    const maxY = 300 - RAIL_HEIGHT - VIEWPORT_MARGIN; // 12
    expect(instance.getState().rendered.y).toBeGreaterThan(maxY); // now out of bounds

    instance.handleScroll();
    expect(instance.getState().state).toBe("settled"); // scroll never changes state

    instance.step(settledAt + 16);

    expect(instance.getState().state).toBe("settled");
    expect(instance.getState().rendered.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(instance.getState().rendered.y).toBeLessThanOrEqual(maxY);
  });

  test("RS-18 scroll while tracking keeps tracking and the glide continues", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    instance.step(T0);

    instance.handleScroll();
    expect(instance.getState().state).toBe("tracking");
    expect(instance.root.dataset["state"]).toBe("tracking");

    const before = instance.getState().rendered.y;
    instance.step(T0 + 32);
    expect(instance.getState().rendered.y).toBeCloseTo(
      lerp(before, expectedRailY(400), FOLLOW_FACTOR),
      6,
    );
  });

  test("RS-19 prefers-reduced-motion snaps rendered Y to the target in one step", () => {
    const reducedMotion: MediaQueryList = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    };
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => reducedMotion;
    try {
      const instance = setupRail();
      const reply = mountReply("alice");

      moveOver(instance, reply, 300, 700);
      instance.step(T0);

      expect(instance.getState().state).toBe("tracking");
      expect(instance.getState().rendered.y).toBe(expectedRailY(700)); // 480, exactly
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test("RS-21 the follow loop steps while tracking and stops once the rail leaves tracking", () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    window.cancelAnimationFrame = (id: number) => {
      cancelled.push(id);
    };
    try {
      const instance = setupRail();
      const reply = mountReply("alice");

      moveOver(instance, reply, 300, 400);
      expect(callbacks.length).toBe(1); // loop armed on entering tracking

      const before = instance.getState().rendered.y;
      callbacks[0]?.(16); // tick: one step, then reschedule
      expect(callbacks.length).toBe(2);
      expect(instance.getState().rendered.y).not.toBe(before);

      pressKey(instance, "Escape"); // collapse cancels the scheduled frame
      expect(cancelled).toContain(2);

      callbacks[1]?.(32); // a late tick observes non-tracking and exits
      expect(callbacks.length).toBe(2);
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
    }
  });

  test("RS-22 scroll clamps synchronously when requestAnimationFrame is unavailable", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unset window.requestAnimationFrame at runtime, which the DOM typings don't allow.
    const globals = window as unknown as Record<string, unknown>;
    const originalRaf = window.requestAnimationFrame;
    globals["requestAnimationFrame"] = undefined;
    try {
      const instance = setupRail();
      const reply = mountReply("alice");
      settleByDwell(instance, reply, 300, 700);

      setViewportHeight(300);
      const maxY = 300 - RAIL_HEIGHT - VIEWPORT_MARGIN;
      instance.handleScroll();

      expect(instance.getState().rendered.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
      expect(instance.getState().rendered.y).toBeLessThanOrEqual(maxY);
    } finally {
      globals["requestAnimationFrame"] = originalRaf;
    }
  });

  test("RS-23 scroll coalesces to one clamp per frame; a frame landing after collapse is inert", () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    window.cancelAnimationFrame = (id: number) => {
      cancelled.push(id);
    };
    try {
      const instance = setupRail();
      const reply = mountReply("alice");
      settleByDwell(instance, reply, 300, 700);

      setViewportHeight(300);
      const maxY = 300 - RAIL_HEIGHT - VIEWPORT_MARGIN;
      const before = callbacks.length;
      instance.handleScroll();
      instance.handleScroll(); // storms coalesce: still just one scheduled frame
      expect(callbacks.length).toBe(before + 1);

      callbacks[before]?.(16);
      expect(instance.getState().rendered.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
      expect(instance.getState().rendered.y).toBeLessThanOrEqual(maxY);

      // A frame scheduled while settled but delivered after a collapse does nothing.
      instance.handleScroll();
      const clampedY = instance.getState().rendered.y;
      pressKey(instance, "Escape");
      callbacks[before + 1]?.(32);
      expect(instance.getState().state).toBe("collapsed");
      expect(instance.getState().rendered.y).toBe(clampedY);

      // destroy() cancels a still-pending scroll frame.
      instance.handleScroll(); // collapsed -> no schedule
      settleByDwell(instance, reply, 310, 700);
      instance.handleScroll();
      const pendingId = callbacks.length;
      instance.destroy();
      expect(cancelled).toContain(pendingId);
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
    }
  });

  test("RS-20 a running batch pins the rail settled until the batch ends", () => {
    const instance = setupRail();
    const reply = mountReply("alice");

    moveOver(instance, reply, 300, 400);
    expect(instance.getState().state).toBe("tracking");

    batchState.running = true;
    moveOver(instance, reply, 300, 500);
    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");

    moveOver(instance, reply, 300, 600); // still pinned mid-batch
    expect(instance.getState().state).toBe("settled");

    batchState.running = false;
    moveOver(instance, reply, 300, 650);
    expect(instance.getState().state).toBe("tracking");
  });

  test("RS-24 Enter on the collapsed puck expands the rail at its current dock position", () => {
    const instance = setupRail();
    const puck = getPuck(instance);
    expect(instance.getState().state).toBe("collapsed");

    puck.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");
  });

  test("RS-25 Space on the puck also expands the rail; unrelated keys do nothing", () => {
    const instance = setupRail();
    const puck = getPuck(instance);

    puck.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(instance.getState().state).toBe("collapsed");

    puck.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(instance.getState().state).toBe("settled");
  });

  test("RS-26 a pointerup on the puck within the jitter threshold expands it (a click, not a drag)", () => {
    const instance = setupRail();
    const puck = getPuck(instance);

    puck.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    puck.dispatchEvent(pointerEvent("pointerup", 102, 101)); // ~2.2px, below the 4px threshold

    expect(instance.getState().state).toBe("settled");
    expect(instance.root.dataset["state"]).toBe("settled");
  });

  test("RS-27 a pointerup that moved past the jitter threshold is a drag, not a click", () => {
    const instance = setupRail();
    const puck = getPuck(instance);

    puck.dispatchEvent(pointerEvent("pointerdown", 100, 100));
    puck.dispatchEvent(pointerEvent("pointermove", 140, 150));
    puck.dispatchEvent(pointerEvent("pointerup", 140, 150));

    expect(instance.getState().state).toBe("collapsed");
  });

  test("RS-28 handleResize reclamps a docked rail on both axes when requestAnimationFrame is unavailable", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unset window.requestAnimationFrame at runtime, which the DOM typings don't allow.
    const globals = window as unknown as Record<string, unknown>;
    const originalRaf = window.requestAnimationFrame;
    globals["requestAnimationFrame"] = undefined;
    try {
      storageFake.data["dockPosition"] = { x: 900, y: 200 };
      const instance = setupRail();
      await settleMicrotasks();
      expect(instance.root.style.left).toBe("900px");
      expect(instance.root.style.top).toBe("200px");

      setViewportWidth(500);
      setViewportHeight(300);
      instance.handleResize();

      // maxX = max(8, 500 - 60 - 8) = 432; maxY = max(8, 300 - 280 - 8) = 12
      expect(instance.root.style.left).toBe("432px");
      expect(instance.root.style.top).toBe("12px");
    } finally {
      globals["requestAnimationFrame"] = originalRaf;
    }
  });

  test("RS-29 resize coalesces to one clamp per frame; destroy cancels a still-pending frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    window.cancelAnimationFrame = (id: number) => {
      cancelled.push(id);
    };
    try {
      const instance = setupRail();

      instance.handleResize();
      instance.handleResize(); // storms coalesce: still just one scheduled frame
      expect(callbacks.length).toBe(1);

      callbacks[0]?.(16);
      expect(callbacks.length).toBe(1); // the frame ran; nothing left pending

      instance.handleResize();
      expect(callbacks.length).toBe(2);
      const pendingId = callbacks.length;
      instance.destroy();
      expect(cancelled).toContain(pendingId);
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
    }
  });
});
