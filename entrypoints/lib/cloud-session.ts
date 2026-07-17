import { blockedStore } from "./blocked-store";
import { CLOUD_BACKUP_KEY, storageSet } from "./chrome-storage";
import {
  type CloudAdapter,
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

const loadDefaultAdapter: LoadCloudAdapter = async () =>
  (await import("./convex-sync")).convexAdapter;

const probeDefaultConfiguration: ProbeConfiguredPort = async () =>
  (await import("./convex-sync")).isCloudConfigured();

const clearDefaultCloud: ClearCloudPort = async () => (await import("./convex-sync")).clearCloud();

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
      const pending = await blockedStore.pending();
      if (pending.length > 0) {
        await blockedStore.markSynced(pending.map((item) => item.action.actionId));
      }
      await storageSet({ [SYNC_META_KEY]: {}, [CLOUD_BACKUP_KEY]: false });
      return { pendingCount: (await blockedStore.pending()).length };
    },
  };
}
