// Catalog: BG-* (background auto-sync: the debounced outbox-watch scheduler and the
// service-worker entrypoint wiring that keeps cloud state from lagging local state).
import { beforeEach, describe, expect, test } from "bun:test";

import {
  createBackgroundSyncScheduler,
  readCloudBackupEnabled,
  OUTBOX_SYNC_DEBOUNCE_MS,
  PERIODIC_SYNC_ALARM,
  PERIODIC_SYNC_MINUTES,
} from "../entrypoints/lib/background-sync.ts";
import { OUTBOX_STORAGE_KEY } from "../entrypoints/lib/blocked-store.ts";
import { installManualTimers, settleMicrotasks } from "./helpers/timers.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

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
      const background = await import("../entrypoints/background.ts");
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
});
