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
import { runAutoCloudSync } from "./lib/sync-engine";

// The reply rail's settings button lives in a content script, which cannot call
// chrome.runtime.openOptionsPage; it posts this message and the worker opens the page.
const OPEN_OPTIONS_MESSAGE_TYPE = "xb-open-options";

function isOpenOptionsMessage(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    Reflect.get(message, "type") === OPEN_OPTIONS_MESSAGE_TYPE
  );
}

export function startBackgroundSync(): void {
  const scheduler = createBackgroundSyncScheduler({
    isEnabled: readCloudBackupEnabled,
    sync: () => runAutoCloudSync(true),
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

  // The content-script rail cannot open the options page itself, so it asks the worker to.
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (isOpenOptionsMessage(message)) {
      void chrome.runtime.openOptionsPage();
    }
  });
}

export default defineBackground(() => {
  startBackgroundSync();
});
