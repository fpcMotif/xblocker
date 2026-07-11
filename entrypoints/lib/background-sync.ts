// Scheduling for the background worker's automatic cloud sync.
//
// The content script can only write the outbox; it never talks to Convex (cross-origin
// traffic stays out of x.com's context). Before the background worker existed, queued
// actions sat in the outbox until the user happened to open the popup — cloud state
// lagged local state by an unbounded time. This scheduler drains the outbox shortly
// after it grows (debounced, so a bulk run becomes one batched push) and on a periodic
// alarm as a safety net.

import { CLOUD_BACKUP_KEY, storageGet, storageRemove, storageSet } from "./chrome-storage";

export const OUTBOX_SYNC_DEBOUNCE_MS = 10_000;
export const PERIODIC_SYNC_ALARM = "xblocker-cloud-sync";
export const PERIODIC_SYNC_MINUTES = 30;

/** Persisted deadline for the debounced sync, so it survives MV3 service-worker
 *  eviction: the in-memory setTimeout dies with the worker, but this timestamp does
 *  not, and a later wake (worker startup or an alarm) can catch up on it. */
export const SYNC_DUE_KEY = "syncDueAt";

export type BackgroundSyncDeps = {
  /** Whether the user has opted into cloud backup (reads the cloudBackup key). */
  isEnabled: () => Promise<boolean>;
  /** Run one sync (push outbox + pull remote). Errors are logged, never thrown. */
  sync: () => Promise<unknown>;
  /** Debounce for outbox changes; tests inject 0. */
  debounceMs?: number;
  /** Wall-clock now; injected so tests can drive the due-at math without real timers. */
  now?: () => number;
  /** Read the persisted debounce due-at (undefined if none is armed); injected for tests. */
  readDueAt?: () => Promise<number | undefined>;
  /** Persist the debounce due-at, or clear it when passed undefined; injected for tests. */
  writeDueAt?: (at: number | undefined) => Promise<void>;
};

export type BackgroundSyncScheduler = {
  /** The outbox storage key changed: debounce, then sync once it settles. */
  onOutboxChanged: () => void;
  /** A chrome alarm fired; syncs when it is the periodic sync alarm. */
  onAlarm: (name: string) => void;
  /** Cancel any pending debounce (teardown in tests). */
  cancel: () => void;
};

function readSyncDueAt(): Promise<number | undefined> {
  return storageGet<number>(SYNC_DUE_KEY);
}

// Clearing must go through remove: chrome.storage.local.set drops undefined values,
// so a set-to-undefined would leave the stale deadline in place forever.
function writeSyncDueAt(at: number | undefined): Promise<void> {
  return at === undefined ? storageRemove(SYNC_DUE_KEY) : storageSet({ [SYNC_DUE_KEY]: at });
}

export function createBackgroundSyncScheduler(deps: BackgroundSyncDeps): BackgroundSyncScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = deps.debounceMs ?? OUTBOX_SYNC_DEBOUNCE_MS;
  const now = deps.now ?? Date.now;
  const readDueAt = deps.readDueAt ?? readSyncDueAt;
  const writeDueAt = deps.writeDueAt ?? writeSyncDueAt;

  function armTimer(delayMs: number): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncIfEnabled();
    }, delayMs);
  }

  async function syncIfEnabled(): Promise<void> {
    try {
      // Captured before the push so the clear below can tell the debounce this sync
      // settles apart from one re-armed mid-flight: a re-arm means actions queued
      // after this sync read the outbox, and its due-at must survive to fire later.
      const settling = await readDueAt();
      if (!(await deps.isEnabled())) return;
      await deps.sync();
      if (settling !== undefined && (await readDueAt()) === settling) {
        await writeDueAt(undefined);
      }
    } catch (error) {
      // Background syncs are best-effort: the outbox keeps the actions, and the next
      // debounce/alarm/popup-open retries idempotently. The due-at is left in place on
      // failure so the next catch-up check retries this sync too.
      console.warn("XBlocker background sync failed:", error);
    }
  }

  /** Catch up a debounce that armed before the worker was evicted: MV3 kills the
   *  in-memory setTimeout on eviction, but the persisted due-at survives it. A wake
   *  past the deadline runs the sync the timer would have fired; a wake before it
   *  re-arms the timer for the remainder instead of leaving the sync to the alarm. */
  async function catchUpIfDue(): Promise<void> {
    const dueAt = await readDueAt();
    if (typeof dueAt !== "number") return;
    const remaining = dueAt - now();
    if (remaining <= 0) {
      await syncIfEnabled();
      return;
    }
    if (timer === null) armTimer(remaining);
  }

  // Runs once per scheduler lifetime — i.e. on worker startup, since background.ts
  // creates exactly one scheduler when the service worker boots.
  void catchUpIfDue();

  return {
    onOutboxChanged() {
      void writeDueAt(now() + debounceMs);
      armTimer(debounceMs);
    },
    onAlarm(name) {
      if (name === PERIODIC_SYNC_ALARM) {
        // The periodic sync drains the same outbox a due debounce would, so it
        // subsumes any catch-up; running both would push the same batch twice.
        void syncIfEnabled();
        return;
      }
      void catchUpIfDue();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Read the cloud backup opt-in flag. */
export async function readCloudBackupEnabled(): Promise<boolean> {
  return (await storageGet<boolean>(CLOUD_BACKUP_KEY)) === true;
}
