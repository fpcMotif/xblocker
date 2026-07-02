// Background (MV3 service worker) entrypoint: automatic cloud sync.
//
// Watches the outbox the content script fills and drains it to Convex shortly after it
// grows, plus a periodic alarm as a safety net — so cloud state no longer waits for the
// user to open the popup. All scheduling logic lives in lib/background-sync (covered by
// unit tests); this file is the thin chrome wiring.

import { defineBackground } from "wxt/utils/define-background";

import { OUTBOX_STORAGE_KEY } from "./lib/blocked-store";
import {
  createBackgroundSyncScheduler,
  readCloudBackupEnabled,
  PERIODIC_SYNC_ALARM,
  PERIODIC_SYNC_MINUTES,
} from "./lib/background-sync";
import { runCloudSync } from "./lib/sync-engine";

export function startBackgroundSync(): void {
  const scheduler = createBackgroundSyncScheduler({
    isEnabled: readCloudBackupEnabled,
    sync: runCloudSync,
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(OUTBOX_STORAGE_KEY in changes)) return;
    scheduler.onOutboxChanged();
  });

  // chrome.alarms survives service-worker teardown, unlike a plain timer.
  void chrome.alarms?.create(PERIODIC_SYNC_ALARM, { periodInMinutes: PERIODIC_SYNC_MINUTES });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    scheduler.onAlarm(alarm.name);
  });
}

export default defineBackground(() => {
  startBackgroundSync();
});
