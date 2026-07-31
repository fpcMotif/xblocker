// Deep Cloud backup module shared by the popup, settings, and background worker.
//
// Configuration and state inspection stay in this small bundle. The Convex transport
// is imported only when an operation will actually touch the network.

import { blockedStore, type OutboxItem, type RemoteAccount } from "./blocked-store";
import { isCloudConfigured as readCloudConfiguration } from "./cloud-config";
import { CLOUD_BACKUP_KEY, storageGet, storageSetStrict } from "./chrome-storage";
import { createExclusiveRunner, type ExclusiveRunner } from "./exclusive-lock";

/**
 * The cloud transport seam, spoken entirely in the store's own vocabulary
 * (`OutboxItem` in, accepted action ids out, `RemoteAccount[]` on pull) — the Convex
 * wire shape never crosses this seam. `isConfigured` is synchronous and side-effect-free
 * and is always checked before any network I/O. Adapter operations may reject; the
 * module preserves those failures so callers own presentation and retry behavior.
 */
export type CloudAdapter = {
  push(items: OutboxItem[]): Promise<string[]>;
  pull(): Promise<RemoteAccount[]>;
  clear(): Promise<void>;
};

export async function loadConvexAdapter(): Promise<CloudAdapter> {
  const { convexAdapter } = await import("./convex-sync");
  return convexAdapter;
}

const SYNC_META_KEY = "cloudSyncMeta";

/** A pull refreshes remote state even with nothing to push; how old the last sync may
 *  be before an auto-sync considers the local view stale. */
const SYNC_STALE_MS = 15 * 60 * 1000;

export type SyncMeta = { lastSyncAt?: number };

type SyncOutcome = { pushed: number; pulled: number; at: number };

export type CloudBackupSnapshot =
  | { availability: "unconfigured" }
  | {
      availability: "configured";
      enabled: boolean;
      pendingActions: number;
      lastSyncedAt: number | null;
    };

export type CloudBackup = {
  inspect(): Promise<CloudBackupSnapshot>;
  act(intent: CloudBackupIntent): Promise<CloudBackupResult>;
};

type CloudBackupDependencies = {
  loadAdapter?: () => Promise<CloudAdapter>;
  isConfigured?: () => boolean;
  now?: () => number;
  runExclusive?: ExclusiveRunner;
};

export type CloudBackupIntent =
  | { kind: "sync"; trigger: "automatic" | "manual" }
  | { kind: "set-enabled"; enabled: boolean }
  | { kind: "wipe" };

export type CloudBackupResult = (
  | { outcome: "skipped"; reason: "disabled" | "fresh" | "unconfigured" }
  | { outcome: "synced"; pushed: number; pulled: number; at: number }
  | { outcome: "updated" }
  | { outcome: "wiped" }
) & { snapshot: CloudBackupSnapshot };

const runCloudOperation = createExclusiveRunner("xblocker-cloud-backup");

export function createCloudBackup(deps: CloudBackupDependencies = {}): CloudBackup {
  const loadAdapter = deps.loadAdapter ?? loadConvexAdapter;
  const isConfigured = deps.isConfigured ?? readCloudConfiguration;
  const now = deps.now ?? Date.now;
  const runExclusive = deps.runExclusive ?? runCloudOperation;

  return {
    inspect: () => readSnapshot(isConfigured),
    act(intent) {
      return runExclusive(async () => {
        if (intent.kind === "set-enabled") {
          await storageSetStrict({ [CLOUD_BACKUP_KEY]: intent.enabled });
          return { outcome: "updated", snapshot: await readSnapshot(isConfigured) };
        }

        if (intent.kind === "wipe") {
          if (!isConfigured()) {
            return {
              outcome: "skipped",
              reason: "unconfigured",
              snapshot: { availability: "unconfigured" },
            };
          }
          await storageSetStrict({ [CLOUD_BACKUP_KEY]: false });
          const pendingAtStart = await blockedStore.pending();
          const adapter = await loadAdapter();
          await adapter.clear();
          if (pendingAtStart.length > 0) {
            await blockedStore.markSynced(pendingAtStart.map((item) => item.action.actionId));
          }
          await storageSetStrict({ [SYNC_META_KEY]: {} });
          return { outcome: "wiped", snapshot: await readSnapshot(isConfigured) };
        }

        if (intent.trigger === "automatic") {
          const [enabled, pending, meta] = await Promise.all([
            storageGet<boolean>(CLOUD_BACKUP_KEY),
            blockedStore.pending(),
            getSyncMeta(),
          ]);
          if (enabled !== true) {
            return {
              outcome: "skipped",
              reason: "disabled",
              snapshot: await readSnapshot(isConfigured),
            };
          }
          if (!shouldAutoSync(true, pending.length, meta, now())) {
            return {
              outcome: "skipped",
              reason: "fresh",
              snapshot: await readSnapshot(isConfigured),
            };
          }
        }

        if (!isConfigured()) {
          return {
            outcome: "skipped",
            reason: "unconfigured",
            snapshot: { availability: "unconfigured" },
          };
        }
        const outcome = await runCloudSync(now, loadAdapter);
        return {
          outcome: "synced",
          pushed: outcome.pushed,
          pulled: outcome.pulled,
          at: outcome.at,
          snapshot: await readSnapshot(isConfigured),
        };
      });
    },
  };
}

export const cloudBackup = createCloudBackup();

function isSyncMeta(value: unknown): value is SyncMeta {
  return typeof value === "object" && value !== null;
}

async function getSyncMeta(): Promise<SyncMeta> {
  const meta = await storageGet<unknown>(SYNC_META_KEY);
  return isSyncMeta(meta) ? meta : {};
}

function writeSyncMeta(meta: SyncMeta): Promise<void> {
  return storageSetStrict({ [SYNC_META_KEY]: meta });
}

async function readSnapshot(isConfigured: () => boolean): Promise<CloudBackupSnapshot> {
  if (!isConfigured()) return { availability: "unconfigured" };
  const [enabled, pending, meta] = await Promise.all([
    storageGet<boolean>(CLOUD_BACKUP_KEY),
    blockedStore.pending(),
    getSyncMeta(),
  ]);
  return {
    availability: "configured",
    enabled: enabled === true,
    pendingActions: pending.length,
    lastSyncedAt: meta.lastSyncAt ?? null,
  };
}

/**
 * Whether opening a surface (popup) or waking (background) should sync without the
 * user asking: only when backup is on, and only when there is something to push or
 * the last pull is stale enough that the mirrored state may lag.
 */
function shouldAutoSync(
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
async function runCloudSync(
  now: () => number = Date.now,
  loadAdapter: () => Promise<CloudAdapter> = loadConvexAdapter,
): Promise<SyncOutcome> {
  const adapter = await loadAdapter();

  const pending = await blockedStore.pending();
  let pushed = 0;
  if (pending.length > 0) {
    const synced = await adapter.push(pending);
    await blockedStore.markSynced(synced);
    pushed = synced.length;
  }
  const remote = await adapter.pull();
  await blockedStore.mergeRemote(remote);

  const at = now();
  await writeSyncMeta({ lastSyncAt: at });
  return { pushed, pulled: remote.length, at };
}
