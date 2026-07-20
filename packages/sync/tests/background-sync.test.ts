// Catalog: BG-* (background auto-sync: the debounced outbox-watch scheduler and the
// service-worker entrypoint wiring that keeps cloud state from lagging local state).
import { beforeEach, describe, expect, test } from "bun:test";

import {
  createBackgroundSyncScheduler,
  readCloudBackupEnabled,
  OUTBOX_SYNC_DEBOUNCE_MS,
  PERIODIC_SYNC_ALARM,
  PERIODIC_SYNC_MINUTES,
  SYNC_DUE_KEY,
} from "../background-sync.ts";
import { OUTBOX_STORAGE_KEY } from "../../storage/blocked-store.ts";
import { installManualTimers, settleMicrotasks } from "../../../test/helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "../../../test/setup.ts";

beforeEach(() => {
  resetTestEnvironment();
});

function makeDeps(enabled = true) {
  const log: string[] = [];
  return {
    log,
    deps: {
      isEnabled: async () => {
        log.push("isEnabled");
        return enabled;
      },
      sync: async () => {
        log.push("sync");
      },
      debounceMs: 0,
    },
  };
}

async function settleTimersAndMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await settleMicrotasks();
}

describe("background sync scheduler", () => {
  test("BG-01 a burst of outbox changes coalesces into one sync", async () => {
    const { log, deps } = makeDeps();
    const scheduler = createBackgroundSyncScheduler(deps);

    scheduler.onOutboxChanged();
    scheduler.onOutboxChanged();
    scheduler.onOutboxChanged();
    await settleTimersAndMicrotasks();

    expect(log).toEqual(["isEnabled", "sync"]);
  });

  test("BG-02 the default debounce leaves room for a whole bulk run to queue up", () => {
    const timers = installManualTimers();
    try {
      const scheduler = createBackgroundSyncScheduler({
        isEnabled: async () => true,
        sync: async () => {},
      });
      scheduler.onOutboxChanged();
      expect(timers.pendingDelays()).toEqual([OUTBOX_SYNC_DEBOUNCE_MS]);
      scheduler.cancel();
    } finally {
      timers.uninstall();
    }
  });

  test("BG-03 the periodic alarm syncs; foreign alarms do not", async () => {
    const { log, deps } = makeDeps();
    const scheduler = createBackgroundSyncScheduler(deps);

    scheduler.onAlarm("something-else");
    await settleMicrotasks();
    expect(log).toEqual([]);

    scheduler.onAlarm(PERIODIC_SYNC_ALARM);
    await settleMicrotasks();
    expect(log).toEqual(["isEnabled", "sync"]);
  });

  test("BG-04 does not sync while cloud backup is off", async () => {
    const { log, deps } = makeDeps(false);
    const scheduler = createBackgroundSyncScheduler(deps);

    scheduler.onOutboxChanged();
    await settleTimersAndMicrotasks();

    expect(log).toEqual(["isEnabled"]);
  });

  test("BG-05 a failing sync is swallowed (the outbox retries later)", async () => {
    const scheduler = createBackgroundSyncScheduler({
      isEnabled: async () => true,
      sync: async () => {
        throw new Error("network down");
      },
      debounceMs: 0,
    });

    scheduler.onOutboxChanged();
    await settleTimersAndMicrotasks(); // must not reject/throw

    scheduler.onAlarm(PERIODIC_SYNC_ALARM);
    await settleMicrotasks();
  });

  test("BG-06 cancel() drops a pending debounce", async () => {
    const { log, deps } = makeDeps();
    const scheduler = createBackgroundSyncScheduler(deps);

    scheduler.onOutboxChanged();
    scheduler.cancel();
    scheduler.cancel(); // idempotent
    await settleTimersAndMicrotasks();

    expect(log).toEqual([]);
  });

  test("BG-07 readCloudBackupEnabled reflects the stored opt-in flag", async () => {
    expect(await readCloudBackupEnabled()).toBe(false);
    storageFake.data["cloudBackup"] = true;
    expect(await readCloudBackupEnabled()).toBe(true);
    storageFake.failNextGet = true;
    expect(await readCloudBackupEnabled()).toBe(false);
  });

  test("BG-09 arming the debounce persists the due-at; a successful sync removes it", async () => {
    const { log, deps } = makeDeps();
    const scheduler = createBackgroundSyncScheduler({ ...deps, now: () => 1_000 });

    scheduler.onOutboxChanged();
    expect(storageFake.data[SYNC_DUE_KEY]).toBe(1_000);

    await settleTimersAndMicrotasks();
    expect(log).toEqual(["isEnabled", "sync"]);
    // Removed outright: a set-to-undefined would leave the stale deadline in real
    // chrome (set drops undefined values) and every later wake would re-sync.
    expect(SYNC_DUE_KEY in storageFake.data).toBe(false);
  });

  test("BG-10 a failed sync leaves the due-at armed; a later wake retries it", async () => {
    let attempts = 0;
    const scheduler = createBackgroundSyncScheduler({
      isEnabled: async () => true,
      sync: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network down");
      },
      debounceMs: 0,
      now: () => 5_000,
    });

    scheduler.onOutboxChanged();
    await settleTimersAndMicrotasks();
    expect(attempts).toBe(1);
    expect(storageFake.data[SYNC_DUE_KEY]).toBe(5_000);

    // Any alarm wake finds the leftover deadline and runs the sync it still owes.
    scheduler.onAlarm("unrelated-alarm");
    await settleTimersAndMicrotasks();
    expect(attempts).toBe(2);
    expect(SYNC_DUE_KEY in storageFake.data).toBe(false);
  });

  test("BG-11 worker startup catches up a debounce that came due during eviction", async () => {
    storageFake.data[SYNC_DUE_KEY] = 4_000;
    const { log, deps } = makeDeps();
    createBackgroundSyncScheduler({ ...deps, now: () => 9_000 });

    await settleTimersAndMicrotasks();
    expect(log).toEqual(["isEnabled", "sync"]);
    expect(SYNC_DUE_KEY in storageFake.data).toBe(false);
  });

  test("BG-12 waking before the deadline re-arms the killed timer for the remainder", async () => {
    storageFake.data[SYNC_DUE_KEY] = 9_000;
    const timers = installManualTimers();
    try {
      const { log, deps } = makeDeps();
      createBackgroundSyncScheduler({ ...deps, now: () => 6_500 });
      await settleMicrotasks();

      expect(log).toEqual([]);
      expect(timers.pendingDelays()).toEqual([2_500]);

      timers.flush();
      await settleMicrotasks();
      expect(log).toEqual(["isEnabled", "sync"]);
      expect(SYNC_DUE_KEY in storageFake.data).toBe(false);
    } finally {
      timers.uninstall();
    }
  });

  test("BG-13 a due-at re-armed mid-sync survives the finished sync's clear", async () => {
    const timers = installManualTimers();
    try {
      const writes: Array<number | undefined> = [];
      let stored: number | undefined;
      let clock = 100;
      let syncs = 0;
      const scheduler = createBackgroundSyncScheduler({
        isEnabled: async () => true,
        sync: async () => {
          syncs += 1;
          if (syncs === 1) {
            // A new action lands mid-flight: this push never saw it, so the debounce
            // it re-arms must not be cleared when this sync finishes.
            clock = 105;
            scheduler.onOutboxChanged();
          }
        },
        debounceMs: 10,
        now: () => clock,
        readDueAt: async () => stored,
        writeDueAt: async (at) => {
          writes.push(at);
          stored = at;
        },
      });
      await settleMicrotasks();

      scheduler.onOutboxChanged();
      timers.flush();
      await settleMicrotasks();
      expect(syncs).toBe(1);
      expect(stored).toBe(115);
      expect(writes).toEqual([110, 115]);

      // The surviving debounce fires normally and settles its own due-at.
      timers.flush();
      await settleMicrotasks();
      expect(syncs).toBe(2);
      expect(stored).toBeUndefined();
    } finally {
      timers.uninstall();
    }
  });

  test("BG-14 the periodic alarm subsumes a due catch-up instead of double-syncing", async () => {
    const { log, deps } = makeDeps();
    const scheduler = createBackgroundSyncScheduler({ ...deps, now: () => 2_000 });
    await settleMicrotasks();
    storageFake.data[SYNC_DUE_KEY] = 1_000;

    scheduler.onAlarm(PERIODIC_SYNC_ALARM);
    await settleTimersAndMicrotasks();

    expect(log).toEqual(["isEnabled", "sync"]);
    expect(SYNC_DUE_KEY in storageFake.data).toBe(false);
  });
});

describe("background entrypoint wiring", () => {
  type ChangeListener = (changes: Record<string, unknown>, areaName: string) => void;
  type AlarmListener = (alarm: { name: string }) => void;

  test("BG-08 startBackgroundSync wires the outbox watch and the periodic alarm", async () => {
    const changeListeners: ChangeListener[] = [];
    const alarmListeners: AlarmListener[] = [];
    const created: Array<{ name: string; periodInMinutes?: number }> = [];

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install runtime onChanged/alarms fakes the static chrome typings don't model.
    const chromeAny = chrome as unknown as Record<string, unknown>;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same runtime-fake escape hatch for the storage namespace.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    const originalAlarms = chromeAny["alarms"];
    chromeStorage["onChanged"] = {
      addListener: (fn: ChangeListener) => changeListeners.push(fn),
      removeListener: () => {},
    };
    chromeAny["alarms"] = {
      create: (name: string, info: { periodInMinutes?: number }) => created.push({ name, ...info }),
      onAlarm: { addListener: (fn: AlarmListener) => alarmListeners.push(fn) },
    };

    try {
      const background = await import("../../../entrypoints/background.ts");
      // Run through the wxt entrypoint definition, exactly as the worker boots.
      background.default.main();

      expect(created).toEqual([
        { name: PERIODIC_SYNC_ALARM, periodInMinutes: PERIODIC_SYNC_MINUTES },
      ]);
      expect(changeListeners).toHaveLength(1);
      expect(alarmListeners).toHaveLength(1);

      // Unrelated changes and areas never schedule work; an outbox change does.
      // (cloudBackup stays off, so the scheduled sync resolves to a no-op.)
      const timers = installManualTimers();
      try {
        changeListeners[0]!({ whitelist: {} }, "local");
        changeListeners[0]!({ [OUTBOX_STORAGE_KEY]: {} }, "sync");
        expect(timers.pendingDelays()).toEqual([]);
        changeListeners[0]!({ [OUTBOX_STORAGE_KEY]: {} }, "local");
        expect(timers.pendingDelays()).toEqual([OUTBOX_SYNC_DEBOUNCE_MS]);
        timers.flush();
      } finally {
        timers.uninstall();
      }
      await settleMicrotasks();

      // The alarm handler routes through the same guard (backup off -> no-op).
      alarmListeners[0]!({ name: PERIODIC_SYNC_ALARM });
      await settleMicrotasks();
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
      chromeAny["alarms"] = originalAlarms;
    }
  });

  test("BG-15 with cloud backup on, the wired sync dep (runAutoCloudSync) actually runs", async () => {
    const changeListeners: ChangeListener[] = [];
    const alarmListeners: AlarmListener[] = [];

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install runtime onChanged/alarms fakes the static chrome typings don't model.
    const chromeAny = chrome as unknown as Record<string, unknown>;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same runtime-fake escape hatch for the storage namespace.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    const originalAlarms = chromeAny["alarms"];
    chromeStorage["onChanged"] = {
      addListener: (fn: ChangeListener) => changeListeners.push(fn),
      removeListener: () => {},
    };
    chromeAny["alarms"] = {
      create: () => {},
      onAlarm: { addListener: (fn: AlarmListener) => alarmListeners.push(fn) },
    };

    storageFake.data["cloudBackup"] = true;
    // Nothing pending and a fresh lastSyncAt: runAutoCloudSync(true)'s own auto-sync
    // gate reports nothing due, so it resolves to `{ status: "skipped" }` before ever
    // loading the (real, unmocked) convex-sync adapter — invoking it here stays
    // side-effect-safe and never touches Convex.
    const seededMeta = { lastSyncAt: Date.now() };
    storageFake.data["cloudSyncMeta"] = seededMeta;

    try {
      const background = await import("../../../entrypoints/background.ts");
      background.default.main();

      const timers = installManualTimers();
      try {
        changeListeners[0]!({ [OUTBOX_STORAGE_KEY]: {} }, "local");
        timers.flush();
      } finally {
        timers.uninstall();
      }
      await settleMicrotasks();

      // A real sync would have stamped a fresh lastSyncAt; the seeded meta surviving
      // untouched confirms the "nothing due" skip branch ran instead.
      expect(storageFake.data["cloudSyncMeta"]).toEqual(seededMeta);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
      chromeAny["alarms"] = originalAlarms;
    }
  });

  test("BG-16 an xb-open-options message opens the options page; other messages do not", async () => {
    const messageListeners: ((message: unknown) => void)[] = [];
    let openOptionsCalls = 0;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- install runtime alarms fakes the static chrome typings don't model.
    const chromeAny = chrome as unknown as Record<string, unknown>;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same runtime-fake escape hatch for the storage namespace.
    const chromeStorage = chrome.storage as unknown as Record<string, unknown>;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same for the runtime namespace's message + options APIs.
    const chromeRuntime = chrome.runtime as unknown as Record<string, unknown>;
    const originalOnChanged = chromeStorage["onChanged"];
    const originalAlarms = chromeAny["alarms"];
    const originalOnMessage = chromeRuntime["onMessage"];
    // The worker also wires storage/alarms on boot; no-op them so main() doesn't throw.
    chromeStorage["onChanged"] = { addListener: () => {}, removeListener: () => {} };
    chromeAny["alarms"] = { create: () => {}, onAlarm: { addListener: () => {} } };
    chromeRuntime["onMessage"] = {
      addListener: (fn: (message: unknown) => void) => messageListeners.push(fn),
      removeListener: () => {},
    };
    chromeRuntime["openOptionsPage"] = () => {
      openOptionsCalls += 1;
      return Promise.resolve();
    };

    try {
      const background = await import("../../../entrypoints/background.ts");
      background.default.main();

      expect(messageListeners).toHaveLength(1);
      const notify = messageListeners[0]!;

      // Foreign, non-object, and string messages never open the options page.
      notify({ type: "something-else" });
      notify(null);
      notify("xb-open-options");
      expect(openOptionsCalls).toBe(0);

      // The rail's message opens the real options page.
      notify({ type: "xb-open-options" });
      expect(openOptionsCalls).toBe(1);
    } finally {
      chromeStorage["onChanged"] = originalOnChanged;
      chromeAny["alarms"] = originalAlarms;
      chromeRuntime["onMessage"] = originalOnMessage;
      delete chromeRuntime["openOptionsPage"];
    }
  });
});
