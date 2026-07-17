// Shared cloud-sync UI orchestration for the popup and the options Cloud pane: the
// guarded manual sync, the popup's auto-sync-on-open (through runAutoCloudSync, THE
// ADR-0003 gate), the coarse "Synced 4m ago." formatting, and the wipe side-effect
// sequence. Behavior only — no DOM. Each surface keeps its own chrome (telltale dot,
// meta rows, WIPE panel) and translates the logical states below into it.
//
// Ports (see docs/adr/0003 and docs/architecture/handoffs/candidate-b-cloud-session.md):
// - loadAdapter: the sync transport, passed through to runCloudSync/runAutoCloudSync.
//   The auto gate must be able to skip WITHOUT invoking it (a quiet popup open costs no
//   Convex import and no network), so this module never pre-loads the adapter.
// - probeConfigured: mount-time "is this build configured?" UI branching. Deliberately
//   separate from loadAdapter so the probe never couples to the sync gate.
// - clearCloud: the wipe transport, deliberately NOT on CloudAdapter (the options
//   danger zone is its only consumer; the popup never receives this port).
// All production defaults lazy-import convex-sync, the same discipline sync-engine.ts
// already uses for push/pull.

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

/** Logical sync states — surfaces map these into their own chrome. The popup's
 *  SyncRowState uses the same names; the options pane renders them onto its meta rows.
 *  "off" is a popup-only semantic derived from the stored cloudBackup flag before any
 *  session call — the session itself never produces it. */
export type CloudSyncLogicalState = "error" | "idle" | "off" | "syncing" | "unconfigured";

// `| undefined` on each port so surfaces can forward their own possibly-absent opts
// verbatim under exactOptionalPropertyTypes; an explicit undefined means "use the
// production default", same as omitting the key.
export type CloudSyncDeps = {
  loadAdapter?: LoadCloudAdapter | undefined;
  probeConfigured?: ProbeConfiguredPort | undefined;
  clearCloud?: ClearCloudPort | undefined;
  now?: (() => number) | undefined;
};

const defaultLoadAdapter: LoadCloudAdapter = async () =>
  (await import("./convex-sync")).convexAdapter;

const defaultProbeConfigured: ProbeConfiguredPort = async () =>
  (await import("./convex-sync")).isCloudConfigured();

const defaultClearCloud: ClearCloudPort = async () => (await import("./convex-sync")).clearCloud();

/** Human "how long ago" for a surface's idle detail line; coarse on purpose. The single
 *  copy of the strings the popup and options pane used to duplicate. */
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

/** Pure outcome -> logical state mapping. A skipped auto-sync is an idle refresh from
 *  the existing meta, never an error. */
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
  /** Manual "Sync now" — always runCloudSync, never the auto gate. Returns null when a
   *  sync is already in flight (the guard); adapter errors propagate to the caller. */
  runManual(): Promise<ManualSyncResult | null>;
  /** Popup mount auto path — delegates to runAutoCloudSync (THE gate). `onSyncStart`
   *  fires only when the gate proceeds, right as the adapter loads, so a surface can
   *  flip to its "syncing" chrome without the skip path ever flashing it. Errors map
   *  to the "error" state instead of propagating. */
  runAutoOnOpen(
    backupEnabled: boolean,
    hooks?: { onSyncStart?: () => void },
  ): Promise<AutoSyncResult>;
  /** Mount-time configured probe — uses the probeConfigured port, never loadAdapter. */
  isBuildConfigured(): Promise<boolean>;
  /** Whether a sync (manual or auto) currently owns the surface's status — a skipped
   *  auto refresh must not clobber an in-flight manual sync (PU-CB-11). */
  isInFlight(): boolean;
  /** Wipe orchestration (options danger zone only): clearCloud() -> drain the outbox ->
   *  clear sync meta -> turn cloud backup off. Local accounts are untouched. */
  wipeCloud(): Promise<{ pendingCount: number }>;
};

export function createCloudSyncSession(deps: CloudSyncDeps = {}): CloudSyncSession {
  const loadAdapter = deps.loadAdapter ?? defaultLoadAdapter;
  const probeConfigured = deps.probeConfigured ?? defaultProbeConfigured;
  const clearCloud = deps.clearCloud ?? defaultClearCloud;
  const now = deps.now ?? Date.now;

  let inFlight = false;

  async function stateFor(
    outcome: SyncOutcome | { status: "skipped" },
  ): Promise<{ state: CloudSyncLogicalState; detail: string }> {
    const meta = outcome.status === "synced" ? { lastSyncAt: outcome.at } : await getSyncMeta();
    return mapSyncOutcomeToState(outcome, meta, now());
  }

  return {
    isInFlight() {
      return inFlight;
    },

    async runManual() {
      if (inFlight) return null;
      inFlight = true;
      try {
        const outcome = await runCloudSync(now, loadAdapter);
        return { outcome, ...(await stateFor(outcome)) };
      } finally {
        inFlight = false;
      }
    },

    async runAutoOnOpen(backupEnabled, hooks) {
      if (inFlight) {
        // A manual sync already owns the row; report "syncing" and skip the gate
        // entirely rather than racing a second sync against it.
        return { state: "syncing", detail: "", outcome: { status: "skipped" } };
      }
      let started = false;
      try {
        const outcome = await runAutoCloudSync(backupEnabled, now, async () => {
          // The gate decided to proceed: only now does the adapter load. A skip never
          // reaches here, which is the ADR-0003 quiet-path invariant.
          started = true;
          inFlight = true;
          hooks?.onSyncStart?.();
          return loadAdapter();
        });
        return { outcome, ...(await stateFor(outcome)) };
      } catch {
        return { state: "error", detail: "" };
      } finally {
        if (started) inFlight = false;
      }
    },

    isBuildConfigured() {
      return probeConfigured();
    },

    async wipeCloud() {
      await clearCloud();
      // The cloud rows are gone, so the queued outbox actions that produced them must
      // never re-push (that would silently repopulate the cloud the user just wiped) —
      // drain the outbox by marking every pending item synced.
      const drained = await blockedStore.pending();
      if (drained.length > 0) {
        await blockedStore.markSynced(drained.map((item) => item.action.actionId));
      }
      // A wiped cloud with backup left on would just refill on the next auto-sync, so
      // the wipe also turns cloud backup off.
      await storageSet({ [SYNC_META_KEY]: {}, [CLOUD_BACKUP_KEY]: false });
      return { pendingCount: (await blockedStore.pending()).length };
    },
  };
}
