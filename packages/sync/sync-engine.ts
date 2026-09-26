// One-shot cloud sync shared by the popup and the background worker: drain a synced
// collection's local outbox to Convex (batched), pull remote rows, merge, and stamp the
// sync time.
//
// The engine is GENERIC over a "synced collection" (ADR-0005): a local-store port
// (`pending` / `markSynced` / `mergeRemote`, plus an optional first-sync `backfill`)
// paired with a CloudAdapter transport. Two collections exist — the blocklist ledger
// and the whitelist — and one policy ("when do we sync", "how do we push/pull/mark-
// synced") decides for both. Per-collection sync meta lives under the collection's own
// storage key, so a dirty whitelist with a clean blocklist (or the reverse) still
// triggers a sync.
//
// The Convex bundle is imported lazily inside each collection's default loadAdapter,
// so the (heavier) client only loads when a sync actually runs — the popup renders
// instantly and pays the import on first use.

import { blockedStore, type OutboxItem, type RemoteAccount } from "../storage/blocked-store";
import { CLOUD_BACKUP_KEY, storageGet, storageSet } from "../storage/chrome-storage";
import {
  backfillWhitelistOutbox,
  markWhitelistSynced,
  mergeRemoteWhitelist,
  pendingWhitelistOutbox,
  type RemoteWhitelistEntry,
  type WhitelistOutboxItem,
} from "../storage/whitelist-store";

/**
 * The cloud transport seam, spoken entirely in the collection's own vocabulary
 * (outbox items in, accepted action ids out, remote rows on pull) — the Convex wire
 * shape never crosses this seam. `isConfigured` is synchronous and side-effect-free
 * and is always checked before any network I/O. `push`/`pull` may reject;
 * `runCloudSync` does not catch, so callers own error handling. `clear` exists only
 * on collections whose cloud data the user can wipe (the blocklist); it is not part
 * of what the sync engine itself ever calls.
 */
export type CloudAdapter<Item = OutboxItem, Remote = RemoteAccount> = {
  isConfigured(): boolean;
  push(items: Item[]): Promise<string[]>;
  pull(): Promise<Remote[]>;
  clear?(): Promise<void>;
};

/** The local-store half of a synced collection: the port the engine drives. Matches
 *  BlockedStore's pending/markSynced/mergeRemote shape; the whitelist store exposes
 *  the same three plus the first-sync backfill. */
export type SyncedCollectionStore<Item, Remote> = {
  /** Changes not yet confirmed synced to the cloud. */
  pending(): Promise<Item[]>;
  /** Drop outbox entries whose action ids the cloud has now accepted. */
  markSynced(actionIds: string[]): Promise<void>;
  /** Merge a cloud pull into local state. */
  mergeRemote(remote: Remote[]): Promise<void>;
  /** First-sync hook: with no prior lastSyncAt, queue pre-existing local state as
   *  pending before the push, so upgrading with local-only data never looks like the
   *  (empty) cloud copy wiped it. */
  backfill?(): Promise<void>;
};

/** One synced collection: a name, its own sync-meta storage key, its local-store
 *  port, and the lazy loader for its cloud transport. */
export type SyncedCollection<Item, Remote> = {
  name: string;
  metaKey: string;
  store: SyncedCollectionStore<Item, Remote>;
  // A function-typed property, not a method: callers pass it around unbound as the
  // default loader.
  loadAdapter: () => Promise<CloudAdapter<Item, Remote>>;
};

/** Heterogeneous-collection view for the "all collections" drivers. Method-parameter
 *  bivariance makes each concrete collection assignable to this. */
export type AnySyncedCollection = SyncedCollection<unknown, unknown>;
export type AnyCloudAdapter = CloudAdapter<unknown, unknown>;
/** Loader override for tests: one fake adapter served for every collection. */
export type AnyAdapterLoader = (collection: AnySyncedCollection) => Promise<AnyCloudAdapter>;

export const SYNC_META_KEY = "cloudSyncMeta";
export const WHITELIST_SYNC_META_KEY = "whitelistSyncMeta";

/** The blocklist ledger: the first synced collection. Its meta key predates the
 *  generic engine and stays put, so an upgrade keeps the existing last-sync stamp. */
export const blockedCollection: SyncedCollection<OutboxItem, RemoteAccount> = {
  name: "blocked",
  metaKey: SYNC_META_KEY,
  store: blockedStore,
  loadAdapter: async () => (await import("./lib/convex-sync")).convexAdapter,
};

/** The whitelist: the second synced collection, driven by the same engine/policy. */
export const whitelistCollection: SyncedCollection<WhitelistOutboxItem, RemoteWhitelistEntry> = {
  name: "whitelist",
  metaKey: WHITELIST_SYNC_META_KEY,
  store: {
    pending: pendingWhitelistOutbox,
    markSynced: markWhitelistSynced,
    mergeRemote: mergeRemoteWhitelist,
    backfill: backfillWhitelistOutbox,
  },
  loadAdapter: async () => (await import("./lib/convex-sync")).whitelistConvexAdapter,
};

/** Every collection the shared "Cloud backup" toggle and scheduler drive. */
export const SYNCED_COLLECTIONS: readonly AnySyncedCollection[] = [
  blockedCollection,
  whitelistCollection,
];

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

export async function getSyncMeta(metaKey: string = SYNC_META_KEY): Promise<SyncMeta> {
  const meta = await storageGet<unknown>(metaKey);
  return isSyncMeta(meta) ? meta : {};
}

function writeSyncMeta(metaKey: string, meta: SyncMeta): Promise<void> {
  return storageSet({ [metaKey]: meta });
}

/**
 * Whether opening a surface (popup) or waking (background) should sync without the
 * user asking: only when backup is on, and only when there is something to push or
 * the last pull is stale enough that the mirrored state may lag. Evaluated PER
 * COLLECTION by the auto drivers.
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

/** Push a collection's pending outbox changes, pull + merge its remote rows, stamp its
 *  lastSyncAt. On the collection's first-ever sync the store's `backfill` hook runs
 *  before the push (the whitelist's upgrade path). */
export async function runCloudSync<Item, Remote>(
  collection: SyncedCollection<Item, Remote>,
  now: () => number = Date.now,
  loadAdapter: () => Promise<CloudAdapter<Item, Remote>> = collection.loadAdapter,
): Promise<SyncOutcome> {
  const adapter = await loadAdapter();
  if (!adapter.isConfigured()) {
    return { status: "unconfigured" };
  }

  if ((await getSyncMeta(collection.metaKey)).lastSyncAt === undefined) {
    await collection.store.backfill?.();
  }

  const pending = await collection.store.pending();
  // Captured before the push: a store may return its live outbox array, which
  // markSynced then drains — reading .length after that would under-report.
  const pendingCount = pending.length;
  if (pendingCount > 0) {
    const synced = await adapter.push(pending);
    await collection.store.markSynced(synced);
  }
  const remote = await adapter.pull();
  await collection.store.mergeRemote(remote);

  const at = now();
  await writeSyncMeta(collection.metaKey, { lastSyncAt: at });
  return { status: "synced", pushed: pendingCount, pulled: remote.length, at };
}

/**
 * THE gate for a collection's automatic (non-user-initiated) sync triggers. Reads
 * fresh pending count + meta, consults `shouldAutoSync` (the one written-down policy),
 * and returns `{ status: "skipped" }` without loading the adapter when a sync is not
 * due — a quiet alarm costs no Convex import and no network. Manual "Sync now"
 * bypasses this gate and calls `runCloudSync` directly.
 *
 * `onWillSync` fires synchronously the instant the gate has decided a sync is due,
 * right before it delegates to `runCloudSync`. It fires *before* the adapter loads, so
 * the run may still resolve `unconfigured`; it never fires on the `skipped` path.
 */
export async function runAutoCloudSync<Item, Remote>(
  collection: SyncedCollection<Item, Remote>,
  enabled: boolean,
  now: () => number = Date.now,
  loadAdapter: () => Promise<CloudAdapter<Item, Remote>> = collection.loadAdapter,
  onWillSync?: () => void,
): Promise<SyncOutcome | { status: "skipped" }> {
  const [pending, meta] = await Promise.all([
    collection.store.pending(),
    getSyncMeta(collection.metaKey),
  ]);
  if (!shouldAutoSync(enabled, pending.length, meta, now())) {
    return { status: "skipped" };
  }
  onWillSync?.();
  return runCloudSync(collection, now, loadAdapter);
}

/**
 * Manual "Sync now": run every synced collection, in order. All collections mirror to
 * the same Convex deployment, so an unconfigured adapter for the first means
 * unconfigured for all — stop there rather than claim progress. The returned counts
 * sum across collections; each collection stamps its own meta.
 */
export async function runCloudSyncAll(
  now: () => number = Date.now,
  loadAdapter?: AnyAdapterLoader,
): Promise<SyncOutcome> {
  let pushed = 0;
  let pulled = 0;
  let at = now();
  for (const collection of SYNCED_COLLECTIONS) {
    const outcome = await runCloudSync(
      collection,
      now,
      loadAdapter ? () => loadAdapter(collection) : collection.loadAdapter,
    );
    if (outcome.status === "unconfigured") return outcome;
    pushed += outcome.pushed;
    pulled += outcome.pulled;
    at = outcome.at;
  }
  return { status: "synced", pushed, pulled, at };
}

/**
 * The all-collections auto gate: a sync is due when ANY collection's own
 * `shouldAutoSync` says so (pending-count-or-staleness, evaluated per collection).
 * When nothing is due the adapter is never loaded; when something is, every
 * collection syncs — one "Cloud backup" toggle, one policy, both lists. `onWillSync`
 * fires once, the instant the gate decides, before any adapter loads.
 */
export async function runAutoCloudSyncAll(
  enabled: boolean,
  now: () => number = Date.now,
  loadAdapter?: AnyAdapterLoader,
  onWillSync?: () => void,
): Promise<SyncOutcome | { status: "skipped" }> {
  const nowValue = now();
  const due = await Promise.all(
    SYNCED_COLLECTIONS.map(async (collection) => {
      const [pending, meta] = await Promise.all([
        collection.store.pending(),
        getSyncMeta(collection.metaKey),
      ]);
      return shouldAutoSync(enabled, pending.length, meta, nowValue);
    }),
  );
  if (!due.some(Boolean)) {
    return { status: "skipped" };
  }
  onWillSync?.();
  return runCloudSyncAll(now, loadAdapter);
}

/** The combined last-sync view for a surface reporting one age line for all
 *  collections: the OLDEST collection stamp, so the line never overstates freshness. */
export async function readCombinedSyncMeta(): Promise<SyncMeta> {
  const metas = await Promise.all(
    SYNCED_COLLECTIONS.map((collection) => getSyncMeta(collection.metaKey)),
  );
  const stamps = metas
    .map((meta) => meta.lastSyncAt)
    .filter((at): at is number => typeof at === "number");
  return stamps.length > 0 ? { lastSyncAt: Math.min(...stamps) } : {};
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
 * The storage half of a surface's cloud display, per collection: whether backup is
 * switched on (`CLOUD_BACKUP_KEY === true` — one toggle for every collection), the
 * collection's last-sync meta, and its pending-outbox depth. Reads no adapter, so a
 * surface that already holds a configured adapter (the settings pane, which must load
 * it up front for the wipe action) reuses this without re-loading or re-checking it.
 * Surfaces that hold no adapter yet (the popup) probe `configured` through the
 * cloud-session's probe port instead of loading the transport themselves.
 */
export async function readCloudDisplayState(
  collection: AnySyncedCollection = blockedCollection,
): Promise<{
  enabled: boolean;
  meta: SyncMeta;
  pendingCount: number;
}> {
  const [enabled, meta, pending] = await Promise.all([
    storageGet<boolean>(CLOUD_BACKUP_KEY),
    getSyncMeta(collection.metaKey),
    collection.store.pending(),
  ]);
  return { enabled: enabled === true, meta, pendingCount: pending.length };
}
