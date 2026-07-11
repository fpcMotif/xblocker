// Catalog: LN-* (createLiveNumber count-change primitive + formatCount).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  ANIMATE_MS,
  createLiveNumber,
  DEBOUNCE_MS,
  FLASH_MS,
  formatCount,
  type LiveNumberClock,
} from "../entrypoints/lib/live-number.ts";
import { resetTestEnvironment } from "./setup.ts";

// A fully injected fake clock: requestFrame/setTimeout just queue callbacks for the
// test to fire explicitly, so the debounce and the rAF loop never depend on real time.
function createFakeClock() {
  const frames: FrameRequestCallback[] = [];
  const cancelledFrameHandles: number[] = [];
  const timeouts: Array<{ id: number; run: () => void }> = [];
  const cancelledTimeoutHandles: number[] = [];
  let frameId = 0;
  let timeoutId = 0;

  const clock: LiveNumberClock = {
    requestFrame: (callback) => {
      frames.push(callback);
      return ++frameId;
    },
    cancelFrame: (handle) => {
      cancelledFrameHandles.push(handle);
    },
    setTimeout: (callback) => {
      const id = ++timeoutId;
      timeouts.push({ id, run: callback });
      return id;
    },
    clearTimeout: (handle) => {
      cancelledTimeoutHandles.push(handle);
      const index = timeouts.findIndex((entry) => entry.id === handle);
      if (index !== -1) {
        timeouts.splice(index, 1);
      }
    },
  };

  return { clock, frames, cancelledFrameHandles, timeouts, cancelledTimeoutHandles };
}

let el: HTMLElement;

describe("createLiveNumber", () => {
  beforeEach(() => {
    resetTestEnvironment();
    el = document.createElement("span");
  });

  afterEach(() => {
    el.remove();
  });

  test("LN-01 the first set() renders instantly with no debounce or animation scheduled", () => {
    const { clock, frames, timeouts } = createFakeClock();
    const live = createLiveNumber(el, { clock });

    live.set(2000);

    expect(el.textContent).toBe("2,000");
    expect(frames).toHaveLength(0);
    expect(timeouts).toHaveLength(0);
  });

  test("LN-02 set() with the same value as the current display is a no-op", () => {
    const { clock, frames, timeouts } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(5);

    live.set(5);

    expect(el.textContent).toBe("5");
    expect(frames).toHaveLength(0);
    expect(timeouts).toHaveLength(0);
  });

  test("LN-03 a real delta debounces 100ms then animates from the previous value to the target", () => {
    const { clock, frames, timeouts } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(1000);

    live.set(2000);

    expect(timeouts).toHaveLength(1);
    expect(el.textContent).toBe("1,000"); // unchanged until the debounce fires

    timeouts[0]?.run(); // debounce elapses (DEBOUNCE_MS)
    expect(frames).toHaveLength(1); // animation armed

    frames[0]?.(0); // first frame: t=0, eased=0 -> still the start value
    expect(el.textContent).toBe("1,000");
    expect(frames).toHaveLength(2);

    frames[1]?.(ANIMATE_MS / 2); // midway: some integer between 1,000 and 2,000
    const mid = Number(el.textContent?.replace(/,/g, ""));
    expect(mid).toBeGreaterThan(1000);
    expect(mid).toBeLessThan(2000);
    expect(frames).toHaveLength(3);

    frames[2]?.(ANIMATE_MS); // elapsed >= ANIMATE_MS -> snaps exactly to target
    expect(el.textContent).toBe("2,000");
    expect(frames).toHaveLength(3); // no further frame scheduled once done

    expect(DEBOUNCE_MS).toBe(100);
    expect(FLASH_MS).toBe(120);
  });

  test("LN-04 rapid set() calls before the debounce fires coalesce onto the latest value", () => {
    const { clock, frames, timeouts, cancelledTimeoutHandles } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(1);

    live.set(2);
    live.set(3);
    live.set(4); // only this last target should ever animate toward

    // Each new call cancels the previous debounce timer; only one is left pending.
    expect(timeouts).toHaveLength(1);
    expect(cancelledTimeoutHandles).toHaveLength(2);

    timeouts[0]?.run();
    frames[0]?.(0); // baseline tick establishes the animation's start time
    frames[1]?.(ANIMATE_MS); // elapsed >= ANIMATE_MS -> resolves to the coalesced target

    expect(el.textContent).toBe("4");
  });

  test("LN-05 set() back to the currently displayed value while a change is pending cancels it", () => {
    const { clock, frames, timeouts } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(5);

    live.set(9); // schedules a debounce
    live.set(5); // ...but this un-does it before it ever fires

    timeouts[0]?.run();

    expect(el.textContent).toBe("5");
    expect(frames).toHaveLength(0); // no animation needed: target === current
  });

  test("LN-06 prefers-reduced-motion snaps the value and flashes opacity instead of counting", () => {
    const { clock, frames, timeouts } = createFakeClock();
    const live = createLiveNumber(el, { clock, prefersReducedMotion: () => true });
    live.set(3);

    live.set(7);
    timeouts[0]?.run();

    expect(el.textContent).toBe("7"); // snapped immediately, no per-frame counting
    expect(el.style.opacity).toBe("0.4");
    expect(el.style.transitionDuration).toBe(`${FLASH_MS}ms`);

    frames[0]?.(0);
    expect(el.style.opacity).toBe("1");
  });

  test("LN-07 destroy() cancels a mid-flight animation and set() after destroy is inert", () => {
    const { clock, frames, timeouts, cancelledFrameHandles } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(1);
    live.set(10);
    timeouts[0]?.run();
    frames[0]?.(0);
    expect(frames).toHaveLength(2);

    live.destroy();

    expect(cancelledFrameHandles).toContain(2);

    // A frame that lands after destroy is inert (guarded, does not throw or repaint).
    const beforeText = el.textContent;
    frames[1]?.(ANIMATE_MS);
    expect(el.textContent).toBe(beforeText);

    live.set(999); // destroyed: no-op
    expect(el.textContent).toBe(beforeText);
    expect(timeouts).toHaveLength(1); // no new timeout scheduled
  });

  test("LN-08 destroy() before any pending debounce or animation is still safe", () => {
    const { clock } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(1);

    live.destroy();
    live.destroy(); // idempotent
  });

  test("LN-09 a new target mid-animation cancels the in-flight frame and restarts from the rendered value", () => {
    const { clock, frames, timeouts, cancelledFrameHandles } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(0);
    live.set(100);
    timeouts[0]?.run();
    frames[0]?.(0); // baseline tick
    frames[1]?.(90); // halfway through the 180ms animation
    const midRendered = Number(el.textContent);
    expect(midRendered).toBeGreaterThan(0);
    expect(midRendered).toBeLessThan(100);
    expect(frames).toHaveLength(3);

    live.set(200); // a second real delta while the first animation is still running
    timeouts[1]?.run();

    expect(cancelledFrameHandles).toContain(3); // the in-flight frame was cancelled
    expect(frames).toHaveLength(4); // a fresh animation frame was armed

    frames[3]?.(0); // baseline tick of the restarted animation
    frames[4]?.(ANIMATE_MS); // resolves to the newest target
    expect(el.textContent).toBe("200");
  });

  test("LN-10 calling set() again for the same in-flight target is a no-op", () => {
    const { clock, frames, timeouts } = createFakeClock();
    const live = createLiveNumber(el, { clock });
    live.set(0);
    live.set(50);
    timeouts[0]?.run();
    frames[0]?.(0);
    expect(frames).toHaveLength(2);

    live.set(50); // same value the in-flight animation is already heading toward

    expect(timeouts).toHaveLength(1); // no new debounce scheduled
  });

  test("LN-11 uses window's real timer/frame APIs by default (no injected clock)", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelledFrames: number[] = [];
    const timeouts: Array<() => void> = [];
    const cancelledTimeouts: number[] = [];
    let frameId = 0;
    let timeoutId = 0;
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the DOM overload set down to what this module actually calls.
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(callback);
      return ++frameId;
    }) as typeof window.requestAnimationFrame;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same narrowing for cancelAnimationFrame.
    window.cancelAnimationFrame = ((handle: number) => {
      cancelledFrames.push(handle);
    }) as typeof window.cancelAnimationFrame;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same narrowing for setTimeout.
    window.setTimeout = ((callback: () => void) => {
      timeouts.push(callback);
      return ++timeoutId;
    }) as typeof window.setTimeout;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same narrowing for clearTimeout.
    window.clearTimeout = ((handle: number) => {
      cancelledTimeouts.push(handle);
    }) as typeof window.clearTimeout;

    try {
      const live = createLiveNumber(el);
      live.set(1);
      live.set(2); // schedules the real (faked) setTimeout
      live.set(3); // reschedules: exercises the default clearTimeout path

      expect(cancelledTimeouts).toHaveLength(1);
      expect(timeouts).toHaveLength(2);

      timeouts[1]?.(); // fires the debounce -> arms the real (faked) rAF
      expect(frames).toHaveLength(1);

      live.destroy(); // mid-flight -> exercises the default cancelAnimationFrame path
      expect(cancelledFrames).toHaveLength(1);
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancelRaf;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });
});

describe("formatCount", () => {
  test("LN-20 singular for exactly 1, plural otherwise, grouped digits", () => {
    expect(formatCount(1, "account", "accounts")).toBe("1 account");
    expect(formatCount(0, "account", "accounts")).toBe("0 accounts");
    expect(formatCount(2000, "account", "accounts")).toBe("2,000 accounts");
  });
});
