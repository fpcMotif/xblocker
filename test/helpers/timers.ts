// Deterministic timer control. Bun's test runner has no full fake-timer API,
// so we swap globalThis.setTimeout directly. Always uninstall in afterEach.

export type ManualTimers = {
  /** Run every queued callback, including ones scheduled while flushing. */
  flush: () => void;
  /** Run only callbacks scheduled with a delay <= maxDelay. */
  flushUpTo: (maxDelay: number) => void;
  pendingDelays: () => number[];
  uninstall: () => void;
};

type QueuedTimer = { callback: () => void; delay: number };

/** setTimeout queues callbacks; nothing runs until flush()/flushUpTo(). */
export function installManualTimers(): ManualTimers {
  const original = globalThis.setTimeout;
  const globals = globalThis as Record<string, unknown>;
  const queue: QueuedTimer[] = [];

  globals["setTimeout"] = (callback: () => void, delay?: number) => {
    queue.push({ callback, delay: delay ?? 0 });
    return queue.length;
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
        if (index !== -1) queue.splice(index, 1);
        timer.callback();
      }
    },
    pendingDelays: () => queue.map((timer) => timer.delay),
    uninstall() {
      globals["setTimeout"] = original;
    },
  };
}

/** setTimeout runs callbacks synchronously (delay collapsed to zero). */
export function installImmediateTimers(): { uninstall: () => void } {
  const original = globalThis.setTimeout;
  const globals = globalThis as Record<string, unknown>;

  globals["setTimeout"] = (callback: () => void) => {
    callback();
    return 0;
  };

  return {
    uninstall() {
      globals["setTimeout"] = original;
    },
  };
}

/** Drain pending microtasks so fire-and-forget async handlers settle. */
export async function settleMicrotasks(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}
