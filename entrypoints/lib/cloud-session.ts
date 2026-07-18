import { blockedStore } from "./blocked-store";
import { CLOUD_BACKUP_KEY, storageSet } from "./chrome-storage";
import {
  type CloudAdapter,
  formatSyncAge,
  getSyncMeta,
  runAutoCloudSync,
  runCloudSync,
  SYNC_META_KEY,
  type SyncMeta,
  type SyncOutcome,
} from "./sync-engine";

export type LoadCloudAdapter = () => Promise<CloudAdapter>;
export type ProbeConfiguredPort = () => Promise<boolean>;
export type ClearCloudPort = () => Promise<void>;

export type CloudSyncLogicalState = "error" | "idle" | "off" | "syncing" | "unconfigured";

export type CloudSyncDeps = {
  loadAdapter?: LoadCloudAdapter;
  probeConfigured?: ProbeConfiguredPort;
  clearCloud?: ClearCloudPort;
  now?: () => number;
};

export type ManualSyncResult = {
  outcome: SyncOutcome;
  state: CloudSyncLogicalState;
  detail: string;
};

export type AutoSyncResult = {
  state: CloudSyncLogicalState;
  detail: string;
  outcome?: SyncOutcome | { status: "skipped" };
};

export type CloudSyncSession = {
  runManual(): Promise<ManualSyncResult | null>;
  runAutoOnOpen(
    backupEnabled: boolean,
    hooks?: { onSyncStart?: () => void },
  ): Promise<AutoSyncResult>;
  isBuildConfigured(): Promise<boolean>;
  isInFlight(): boolean;
  wipeCloud(): Promise<{ pendingCount: number }>;
};

// Dynamic imports on purpose (ADR-0003): convex-sync pulls in the Convex client bundle,
// and an unconfigured build must never pay for it — the session reaches the transport
// lazily, the same discipline sync-engine's loadConvexAdapter uses for push/pull.
const loadDefaultAdapter: LoadCloudAdapter = async () =>
  (await import("./convex-sync")).convexAdapter;

const probeDefaultConfiguration: ProbeConfiguredPort = async () =>
  (await import("./convex-sync")).isCloudConfigured();

const clearDefaultCloud: ClearCloudPort = async () => {
  const adapter = (await import("./convex-sync")).convexAdapter;
  if (!adapter.isConfigured()) {
    throw new Error("Convex deployment URL is not configured (set VITE_CONVEX_URL).");
  }
  await adapter.clear();
};

// The formatter lives in sync-engine (it owns SyncMeta) — re-exported here so the
// session's consumers (popup, options pane, tests) import one cloud-facing module.
export { formatSyncAge };

export function mapSyncOutcomeToState(
  outcome: SyncOutcome | { status: "skipped" },
  meta: SyncMeta,
  now: number,
): { state: CloudSyncLogicalState; detail: string } {
  if (outcome.status === "unconfigured") return { state: "unconfigured", detail: "" };
  if (outcome.status === "synced") {
    return { state: "idle", detail: formatSyncAge({ lastSyncAt: outcome.at }, now) };
  }
  return { state: "idle", detail: formatSyncAge(meta, now) };
}

export function createCloudSyncSession(deps: CloudSyncDeps = {}): CloudSyncSession {
  const loadAdapter = deps.loadAdapter ?? loadDefaultAdapter;
  const probeConfigured = deps.probeConfigured ?? probeDefaultConfiguration;
  const clearCloud = deps.clearCloud ?? clearDefaultCloud;
  const now = deps.now ?? Date.now;
  let owner: "auto" | "manual" | undefined;
  const autoSuperseded = Symbol();

  async function mapOutcome(
    outcome: SyncOutcome | { status: "skipped" },
  ): Promise<{ state: CloudSyncLogicalState; detail: string }> {
    const meta = outcome.status === "skipped" ? await getSyncMeta() : {};
    return mapSyncOutcomeToState(outcome, meta, now());
  }

  return {
    isInFlight: () => owner !== undefined,

    async runManual() {
      if (owner) return null;
      owner = "manual";
      try {
        const outcome = await runCloudSync(now, loadAdapter);
        return { outcome, ...(await mapOutcome(outcome)) };
      } finally {
        if (owner === "manual") owner = undefined;
      }
    },

    async runAutoOnOpen(backupEnabled, hooks) {
      if (owner) return { state: "syncing", detail: "" };
      let started = false;
      try {
        const outcome = await runAutoCloudSync(backupEnabled, now, async () => {
          if (owner) throw autoSuperseded;
          started = true;
          owner = "auto";
          hooks?.onSyncStart?.();
          return loadAdapter();
        });
        return { outcome, ...(await mapOutcome(outcome)) };
      } catch (error) {
        if (error === autoSuperseded) return { state: "syncing", detail: "" };
        return { state: "error", detail: "" };
      } finally {
        if (started && owner === "auto") owner = undefined;
      }
    },

    isBuildConfigured: () => probeConfigured(),

    async wipeCloud() {
      await clearCloud();
      // The cloud rows are gone, so the queued outbox actions that produced them must
      // never re-push (that would silently repopulate the cloud the user just wiped) —
      // drain the outbox by marking every pending item synced.
      const pending = await blockedStore.pending();
      if (pending.length > 0) {
        await blockedStore.markSynced(pending.map((item) => item.action.actionId));
      }
      // A wiped cloud with backup left on would just refill on the next auto-sync, so
      // the wipe also turns cloud backup off.
      await storageSet({ [SYNC_META_KEY]: {}, [CLOUD_BACKUP_KEY]: false });
      return { pendingCount: (await blockedStore.pending()).length };
    },
  };
}
