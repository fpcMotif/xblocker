// One-shot cloud sync shared by the popup and the background worker: drain the local
// outbox to Convex (batched), pull remote accounts, merge, and stamp the sync time.
//
// convex-sync is imported lazily so the (heavier) Convex bundle only loads when a sync
// actually runs — the popup renders instantly and pays the import on first use.

import { blockedStore } from "./blocked-store";

export const SYNC_META_KEY = "cloudSyncMeta";

/** A pull refreshes remote state even with nothing to push; how old the last sync may
 *  be before an auto-sync considers the local view stale. */
export const SYNC_STALE_MS = 15 * 60 * 1000;

export type SyncMeta = { lastSyncAt?: number };

export type SyncOutcome =
  | { status: "unconfigured" }
  | { status: "synced"; pushed: number; pulled: number; at: number };

function isSyncMeta(value: unknown): value is SyncMeta {
  return typeof value === "object" && value !== null;
}

export function getSyncMeta(): Promise<SyncMeta> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SYNC_META_KEY, (result) => {
      const meta = result?.[SYNC_META_KEY];
      resolve(isSyncMeta(meta) ? meta : {});
    });
  });
}

function writeSyncMeta(meta: SyncMeta): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SYNC_META_KEY]: meta }, () => resolve());
  });
}

/**
 * Whether opening a surface (popup) or waking (background) should sync without the
 * user asking: only when backup is on, and only when there is something to push or
 * the last pull is stale enough that the mirrored state may lag.
 */
export function shouldAutoSync(
  enabled: boolean,
  pendingCount: number,
  meta: SyncMeta,
  now: number,
): boolean {
  if (!enabled) return false;
  if (pendingCount > 0) return true;
  return typeof meta.lastSyncAt !== "number" || now - meta.lastSyncAt > SYNC_STALE_MS;
}

/** Push pending outbox actions, pull + merge remote accounts, stamp lastSyncAt. */
export async function runCloudSync(now: () => number = Date.now): Promise<SyncOutcome> {
  const sync = await import("./convex-sync");
  if (!sync.isCloudConfigured()) {
    return { status: "unconfigured" };
  }

  const pending = await blockedStore.pending();
  if (pending.length > 0) {
    const synced = await sync.pushOutbox(pending);
    await blockedStore.markSynced(synced);
  }
  const remote = await sync.pullBlocked();
  await blockedStore.mergeRemote(remote);

  const at = now();
  await writeSyncMeta({ lastSyncAt: at });
  return { status: "synced", pushed: pending.length, pulled: remote.length, at };
}
