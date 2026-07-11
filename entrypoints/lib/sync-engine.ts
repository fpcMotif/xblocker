// One-shot cloud sync shared by the popup and the background worker: drain the local
// outbox to Convex (batched), pull remote accounts, merge, and stamp the sync time.
//
// convex-sync is imported lazily so the (heavier) Convex bundle only loads when a sync
// actually runs — the popup renders instantly and pays the import on first use.

import { blockedStore, type OutboxItem, type RemoteAccount } from "./blocked-store";
import { storageGet, storageSet } from "./chrome-storage";

/**
 * The cloud transport seam, spoken entirely in the store's own vocabulary
 * (`OutboxItem` in, accepted action ids out, `RemoteAccount[]` on pull) — the Convex
 * wire shape never crosses this seam. `isConfigured` is synchronous and side-effect-free
 * and is always checked before any network I/O. `push`/`pull` may reject; `runCloudSync`
 * does not catch, so callers own error handling.
 */
export type CloudAdapter = {
  isConfigured(): boolean;
  push(items: OutboxItem[]): Promise<string[]>;
  pull(): Promise<RemoteAccount[]>;
};

async function loadConvexAdapter(): Promise<CloudAdapter> {
  const { convexAdapter } = await import("./convex-sync");
  return convexAdapter;
}

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

export async function getSyncMeta(): Promise<SyncMeta> {
  const meta = await storageGet<unknown>(SYNC_META_KEY);
  return isSyncMeta(meta) ? meta : {};
}

function writeSyncMeta(meta: SyncMeta): Promise<void> {
  return storageSet({ [SYNC_META_KEY]: meta });
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
export async function runCloudSync(
  now: () => number = Date.now,
  loadAdapter: () => Promise<CloudAdapter> = loadConvexAdapter,
): Promise<SyncOutcome> {
  const adapter = await loadAdapter();
  if (!adapter.isConfigured()) {
    return { status: "unconfigured" };
  }

  const pending = await blockedStore.pending();
  if (pending.length > 0) {
    const synced = await adapter.push(pending);
    await blockedStore.markSynced(synced);
  }
  const remote = await adapter.pull();
  await blockedStore.mergeRemote(remote);

  const at = now();
  await writeSyncMeta({ lastSyncAt: at });
  return { status: "synced", pushed: pending.length, pulled: remote.length, at };
}

/**
 * THE gate for every automatic (non-user-initiated) sync trigger — currently the
 * background worker's debounce/alarm (see background.ts). Reads fresh pending count +
 * meta, consults `shouldAutoSync` (the one written-down policy), and returns
 * `{ status: "skipped" }` without loading the adapter when a sync is not due — a quiet
 * alarm costs no Convex import and no network. Manual "Sync now" bypasses this gate and
 * calls `runCloudSync` directly.
 */
export async function runAutoCloudSync(
  enabled: boolean,
  now: () => number = Date.now,
  loadAdapter: () => Promise<CloudAdapter> = loadConvexAdapter,
): Promise<SyncOutcome | { status: "skipped" }> {
  const [pending, meta] = await Promise.all([blockedStore.pending(), getSyncMeta()]);
  if (!shouldAutoSync(enabled, pending.length, meta, now())) {
    return { status: "skipped" };
  }
  return runCloudSync(now, loadAdapter);
}
