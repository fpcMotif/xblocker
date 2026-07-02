// Scheduling for the background worker's automatic cloud sync.
//
// The content script can only write the outbox; it never talks to Convex (cross-origin
// traffic stays out of x.com's context). Before the background worker existed, queued
// actions sat in the outbox until the user happened to open the popup — cloud state
// lagged local state by an unbounded time. This scheduler drains the outbox shortly
// after it grows (debounced, so a bulk run becomes one batched push) and on a periodic
// alarm as a safety net.

export const OUTBOX_SYNC_DEBOUNCE_MS = 10_000;
export const PERIODIC_SYNC_ALARM = "xblocker-cloud-sync";
export const PERIODIC_SYNC_MINUTES = 30;

export type BackgroundSyncDeps = {
  /** Whether the user has opted into cloud backup (reads the cloudBackup key). */
  isEnabled: () => Promise<boolean>;
  /** Run one sync (push outbox + pull remote). Errors are logged, never thrown. */
  sync: () => Promise<unknown>;
  /** Debounce for outbox changes; tests inject 0. */
  debounceMs?: number;
};

export type BackgroundSyncScheduler = {
  /** The outbox storage key changed: debounce, then sync once it settles. */
  onOutboxChanged: () => void;
  /** A chrome alarm fired; syncs when it is the periodic sync alarm. */
  onAlarm: (name: string) => void;
  /** Cancel any pending debounce (teardown in tests). */
  cancel: () => void;
};

export function createBackgroundSyncScheduler(deps: BackgroundSyncDeps): BackgroundSyncScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = deps.debounceMs ?? OUTBOX_SYNC_DEBOUNCE_MS;

  async function syncIfEnabled(): Promise<void> {
    try {
      if (!(await deps.isEnabled())) return;
      await deps.sync();
    } catch (error) {
      // Background syncs are best-effort: the outbox keeps the actions, and the next
      // debounce/alarm/popup-open retries idempotently.
      console.warn("XBlocker background sync failed:", error);
    }
  }

  return {
    onOutboxChanged() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void syncIfEnabled();
      }, debounceMs);
    },
    onAlarm(name) {
      if (name !== PERIODIC_SYNC_ALARM) return;
      void syncIfEnabled();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Read the cloud backup opt-in flag. */
export function readCloudBackupEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get("cloudBackup", (result) => {
      resolve(result?.cloudBackup === true);
    });
  });
}
