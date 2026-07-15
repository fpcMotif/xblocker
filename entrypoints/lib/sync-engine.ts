// One-shot cloud sync shared by the popup and the background worker: drain the local
// outbox to Convex (batched), pull remote accounts, merge, and stamp the sync time.
//
// convex-sync is imported lazily so the (heavier) Convex bundle only loads when a sync
// actually runs — the popup renders instantly and pays the import on first use.

import { blockedStore, type OutboxItem, type RemoteAccount } from "./blocked-store";
import { CLOUD_BACKUP_KEY, storageGet, storageSet } from "./chrome-storage";

/**
 * The cloud transport seam, spoken entirely in the store's own vocabulary
 * (`OutboxItem` in, accepted action ids out, `RemoteAccount[]` on pull) — the Convex
 * wire shape never crosses this seam. `isConfigured` is synchronous and side-effect-free
 * and is always checked before any network I/O. `push`/`pull`/`clear` may reject;
 * `runCloudSync` does not catch, so callers own error handling.
 */
export type CloudAdapter = {
  isConfigured(): boolean;
  push(items: OutboxItem[]): Promise<string[]>;
  pull(): Promise<RemoteAccount[]>;
  clear(): Promise<void>;
};

/** The canonical lazy loader for the production Convex adapter (see the header: the
 *  Convex bundle loads only when a sync or status read actually runs, so an unconfigured
 *  or quiet surface never pays for it). Surfaces default to this; tests inject their own
 *  loader in its place. */
export async function loadConvexAdapter(): Promise<CloudAdapter> {
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
 *
 * `onWillSync` fires synchronously the instant the gate has decided a sync is due, right
 * before it delegates to `runCloudSync` — the hook lets a caller (the popup) surface a
 * busy state exactly when a real sync starts, without re-deriving the `shouldAutoSync`
 * policy the gate already owns. It fires *before* the adapter loads, so the run may still
 * resolve `unconfigured`; it never fires on the `skipped` path (and so trivially cannot
 * fire when the outcome is skipped-because-disabled).
 */
export async function runAutoCloudSync(
  enabled: boolean,
  now: () => number = Date.now,
  loadAdapter: () => Promise<CloudAdapter> = loadConvexAdapter,
  onWillSync?: () => void,
): Promise<SyncOutcome | { status: "skipped" }> {
  const [pending, meta] = await Promise.all([blockedStore.pending(), getSyncMeta()]);
  if (!shouldAutoSync(enabled, pending.length, meta, now())) {
    return { status: "skipped" };
  }
  onWillSync?.();
  return runCloudSync(now, loadAdapter);
}

/**
 * Coarse "how long since the last sync" line. Lives here because sync-engine owns
 * `SyncMeta`; both surfaces (popup sync row + settings cloud pane) import this one copy
 * instead of each keeping a byte-identical twin.
 */
export function formatSyncAge(meta: SyncMeta, now: number): string {
  const at = meta.lastSyncAt;
  if (typeof at !== "number") return "Never synced.";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "Synced just now.";
  if (minutes < 60) return `Synced ${minutes}m ago.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago.`;
  return `Synced ${Math.round(hours / 24)}d ago.`;
}

/**
 * The storage half of a surface's cloud display: whether backup is switched on
 * (`CLOUD_BACKUP_KEY === true`), the last-sync meta, and the pending-outbox depth. Reads no
 * adapter, so a surface that already holds a configured adapter (the settings pane, which
 * must load it up front for the wipe action) reuses this without re-loading or re-checking
 * it. `readCloudStatus` layers the adapter's `configured` on top for surfaces that don't.
 */
export async function readCloudDisplayState(): Promise<{
  enabled: boolean;
  meta: SyncMeta;
  pendingCount: number;
}> {
  const [enabled, meta, pending] = await Promise.all([
    storageGet<boolean>(CLOUD_BACKUP_KEY),
    getSyncMeta(),
    blockedStore.pending(),
  ]);
  return { enabled: enabled === true, meta, pendingCount: pending.length };
}

/**
 * One read of "the cloud world" for a surface's initial render: whether the build is
 * configured (loads the adapter to ask) plus the `readCloudDisplayState` fields. The popup
 * renders from this single read (it holds no adapter yet); the settings pane, which already
 * loaded a configured adapter, reads `readCloudDisplayState` directly. When unconfigured the
 * storage fields are still real — the caller decides whether to render them or fall back to
 * an "unconfigured" state.
 */
export async function readCloudStatus(
  loadAdapter: () => Promise<CloudAdapter> = loadConvexAdapter,
): Promise<{ configured: boolean; enabled: boolean; meta: SyncMeta; pendingCount: number }> {
  const [adapter, display] = await Promise.all([loadAdapter(), readCloudDisplayState()]);
  return { configured: adapter.isConfigured(), ...display };
}
