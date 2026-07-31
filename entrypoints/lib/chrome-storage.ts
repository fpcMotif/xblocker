// Single chrome.storage.local promise wrapper, replacing the six hand-rolled copies
// scattered across this extension (blocked-store.ts, content/actions.ts, popup/main.ts,
// background-sync.ts, cloud-backup.ts, content/rail.ts). Each owning file adopts this
// module on its own schedule — nothing here migrates an existing caller.
//
// blocked-store.ts keeps its own ACCOUNTS_KEY/OUTBOX_KEY reader: its read-modify-write
// mutations deliberately propagate a failed get as a rejection (so a caller can react),
// which is the opposite of the tolerant "degrade to undefined" contract below.

/** Whitelisted handles. */
export const WHITELIST_KEY = "whitelist";
/** Cloud backup opt-in flag. */
export const CLOUD_BACKUP_KEY = "cloudBackup";
/** Reply Rail's dragged-to dock position. */
export const DOCK_POSITION_KEY = "dockPosition";

/**
 * Tolerant read: resolves the value stored at `key`, or undefined when it was never
 * set, the callback got no result object, or chrome.runtime.lastError is set. Matches
 * the existing callers' pattern of degrading to a default instead of surfacing storage
 * errors.
 */
export function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result: { [storageKey: string]: T | undefined }) => {
      resolve(chrome.runtime.lastError || result === undefined ? undefined : result[key]);
    });
  });
}

/** Strict read for modules that must not replace durable state with a default after a
 * failed read. A missing key still resolves undefined. */
export function storageGetStrict<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result: { [storageKey: string]: T | undefined }) => {
      const error = chrome.runtime.lastError;
      if (error || result === undefined) {
        reject(new Error(error?.message ?? "chrome.storage.local.get failed"));
        return;
      }
      resolve(result[key]);
    });
  });
}

/**
 * Fire-and-forget write: resolves once chrome's callback fires, even when
 * chrome.runtime.lastError is set — existing callers never awaited failures here.
 *
 * chrome.storage.local.set DROPS undefined values during serialization (the key keeps
 * its old value), so it can never clear a key — use storageRemove for that.
 */
export function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

/** Durable write for operations that must not report success after Chrome rejected
 * persistence. Use this for Cloud backup lifecycle state and store mutations. */
export function storageSetStrict(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? "chrome.storage.local.set failed"));
        return;
      }
      resolve();
    });
  });
}

/** Delete `key` outright; the only way to clear a key (see storageSet). Same
 *  fire-and-forget contract as storageSet. */
export function storageRemove(key: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, () => resolve());
  });
}

/** Strict delete for one-time migrations that must not leave two sources of truth. */
export function storageRemoveStrict(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? "chrome.storage.local.remove failed"));
        return;
      }
      resolve();
    });
  });
}
