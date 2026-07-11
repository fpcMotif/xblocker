// Shared count-change primitive (docs/plans/2026-07-10-gauge-and-ledger/plan.md, "One
// count-change primitive"): the popup stat strip and the blocked-log footer count both
// animate through this one helper instead of each hand-rolling a count-up. The first
// render is always instant — mount must never animate — and every later distinct value
// coalesces through a trailing debounce, so a storm of chrome.storage.onChanged events
// collapses into a single count-up instead of one per event.
//
// font-variant-numeric (tabular-nums) is a CSS concern left entirely to callers' own
// classes; this module only ever writes textContent (and, for the reduced-motion flash,
// opacity) onto the element it's given.

/** Frame/timer primitives the animation drives through — injectable so tests can drive
 *  the debounce and rAF loop deterministically instead of waiting on real timers. */
export type LiveNumberClock = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
};

export type LiveNumberOptions = {
  clock?: Partial<LiveNumberClock>;
  /** Overrides the window.matchMedia reduced-motion check; mainly for tests. */
  prefersReducedMotion?: () => boolean;
};

export type LiveNumber = {
  set(value: number): void;
  destroy(): void;
};

export const DEBOUNCE_MS = 100;
export const ANIMATE_MS = 180;
export const FLASH_MS = 120;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function defaultPrefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function defaultClock(): LiveNumberClock {
  return {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
}

/** "1 account" / "2,000 accounts" — locale-grouped digits paired with the singular-aware noun. */
export function formatCount(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? singular : plural}`;
}

export function createLiveNumber(el: HTMLElement, opts: LiveNumberOptions = {}): LiveNumber {
  const clock: LiveNumberClock = { ...defaultClock(), ...opts.clock };
  const prefersReducedMotion = opts.prefersReducedMotion ?? defaultPrefersReducedMotion;

  let mounted = false;
  let destroyed = false;
  let current = 0;
  // The value queued by the trailing debounce, cleared once beginUpdate consumes it.
  let pendingTarget: number | undefined;
  // The value an in-flight animation (or flash) is heading toward.
  let animTarget: number | undefined;
  let debounceHandle: number | undefined;
  let frameHandle: number | undefined;

  function render(value: number): void {
    current = value;
    el.textContent = value.toLocaleString("en-US");
  }

  function cancelDebounce(): void {
    if (debounceHandle !== undefined) {
      clock.clearTimeout(debounceHandle);
      debounceHandle = undefined;
    }
  }

  function cancelActiveFrame(): void {
    if (frameHandle !== undefined) {
      clock.cancelFrame(frameHandle);
      frameHandle = undefined;
    }
    animTarget = undefined;
  }

  function flash(target: number): void {
    render(target);
    el.style.transitionProperty = "opacity";
    el.style.transitionDuration = `${FLASH_MS}ms`;
    el.style.transitionTimingFunction = "var(--xb-ease-out)";
    el.style.opacity = "0.4";
    animTarget = target;
    frameHandle = clock.requestFrame(() => {
      frameHandle = undefined;
      animTarget = undefined;
      el.style.opacity = "1";
    });
  }

  function animate(from: number, to: number): void {
    animTarget = to;
    let startTime: number | undefined;
    const step: FrameRequestCallback = (time) => {
      if (destroyed) {
        return;
      }
      if (startTime === undefined) {
        startTime = time;
      }
      const elapsed = time - startTime;
      const done = elapsed >= ANIMATE_MS;
      render(done ? to : Math.round(from + (to - from) * easeOut(elapsed / ANIMATE_MS)));
      if (done) {
        frameHandle = undefined;
        animTarget = undefined;
      } else {
        frameHandle = clock.requestFrame(step);
      }
    };
    frameHandle = clock.requestFrame(step);
  }

  function beginUpdate(): void {
    debounceHandle = undefined;
    const target = pendingTarget;
    pendingTarget = undefined;
    // A value that round-tripped back to `current` before the debounce fired needs
    // no animation — it's already what's on screen.
    if (target === undefined || target === current) {
      return;
    }
    cancelActiveFrame();
    if (prefersReducedMotion()) {
      flash(target);
    } else {
      animate(current, target);
    }
  }

  return {
    set(value: number): void {
      if (destroyed) {
        return;
      }
      if (!mounted) {
        mounted = true;
        render(value);
        return;
      }
      // Whatever the update is already heading toward — pending debounce, in-flight
      // animation, or (idle) the currently displayed value.
      const activeTarget = pendingTarget ?? animTarget ?? current;
      if (value === activeTarget) {
        return;
      }
      pendingTarget = value;
      cancelDebounce();
      debounceHandle = clock.setTimeout(beginUpdate, DEBOUNCE_MS);
    },
    destroy(): void {
      destroyed = true;
      cancelDebounce();
      cancelActiveFrame();
    },
  };
}
