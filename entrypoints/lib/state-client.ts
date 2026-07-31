// Public worker-state boundary. Surfaces speak in domain commands, never storage blobs.

import type {
  BlockAction,
  BlockActionKind,
  BlockSource,
  BlockedAccount,
  BlockedStats,
} from "./blocked-merge";
import type { Settings } from "./settings";
import {
  StateProtocolFailure,
  makeStateRequest,
  parseStateResponse,
  type StateCommand,
  type StateResponse,
} from "./state-protocol";

export type LedgerRecord = {
  actionId: string;
  at: number;
  handle: string;
  kind: BlockActionKind;
  source: BlockSource;
  xUserId?: string;
  fromAccount?: string;
};

export type PendingAction = {
  accountKey: string;
  handle: string;
  idUnknown: boolean;
  action: BlockAction;
  xUserId?: string;
};

export type WhitelistAddResult = "added" | "error" | "exists" | "invalid";
export type WhitelistBatchResult = { added: number; skipped: number; invalid: number };
export type SettingsPatch = Partial<Settings>;

export type CloudInspection = {
  configured: boolean;
  enabled: boolean;
  pendingCount: number;
  lastSyncAt?: number;
  generation?: number;
};

export type CloudSyncResult =
  | { status: "unconfigured" }
  | { status: "skipped" }
  | { status: "stale"; generation: number }
  | { status: "synced"; pushed: number; pulled: number; at: number; generation: number };

export type CloudWipeResult = { status: "unconfigured" } | { status: "wiped"; generation: number };

export interface StateClient {
  ledger: {
    hasActiveHandle(handle: string): Promise<boolean>;
    record(input: LedgerRecord): Promise<BlockedAccount>;
    list(): Promise<BlockedAccount[]>;
    stats(): Promise<BlockedStats>;
    pending(): Promise<PendingAction[]>;
  };
  whitelist: {
    list(): Promise<string[]>;
    add(handle: string): Promise<WhitelistAddResult>;
    remove(handle: string): Promise<void>;
    addMany(handles: string[]): Promise<WhitelistBatchResult>;
  };
  settings: {
    read(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<Settings>;
  };
  cloud: {
    inspect(): Promise<CloudInspection>;
    setEnabled(enabled: boolean): Promise<void>;
    sync(mode: "manual" | "auto"): Promise<CloudSyncResult>;
    wipe(wipeId: string): Promise<CloudWipeResult>;
  };
}

export type StateService = StateClient;
export type SendStateMessage = (message: unknown) => Promise<unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function blockedAccount(value: unknown): value is BlockedAccount {
  return (
    record(value) &&
    typeof value.key === "string" &&
    typeof value.handle === "string" &&
    typeof value.idUnknown === "boolean" &&
    finiteNumber(value.firstActionAt) &&
    finiteNumber(value.lastActionAt) &&
    finiteNumber(value.blockCount) &&
    finiteNumber(value.muteCount) &&
    (value.status === "active" || value.status === "unblocked") &&
    Array.isArray(value.actions)
  );
}

function settings(value: unknown): value is Settings {
  return (
    record(value) &&
    typeof value.protectWhitelist === "boolean" &&
    typeof value.confirmDestructiveActions === "boolean" &&
    typeof value.keyboardMode === "boolean" &&
    finiteNumber(value.maxReplies)
  );
}

function stats(value: unknown): value is BlockedStats {
  return (
    record(value) &&
    finiteNumber(value.accounts) &&
    finiteNumber(value.blocked) &&
    finiteNumber(value.muted)
  );
}

function pending(value: unknown): value is PendingAction[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        typeof item.accountKey === "string" &&
        typeof item.handle === "string" &&
        typeof item.idUnknown === "boolean" &&
        record(item.action),
    )
  );
}

function inspection(value: unknown): value is CloudInspection {
  return (
    record(value) &&
    typeof value.configured === "boolean" &&
    typeof value.enabled === "boolean" &&
    finiteNumber(value.pendingCount) &&
    (value.lastSyncAt === undefined || finiteNumber(value.lastSyncAt)) &&
    (value.generation === undefined || finiteNumber(value.generation))
  );
}

function syncResult(value: unknown): value is CloudSyncResult {
  if (!record(value) || typeof value.status !== "string") return false;
  if (value.status === "unconfigured" || value.status === "skipped")
    return Object.keys(value).length === 1;
  if (value.status === "stale") return finiteNumber(value.generation);
  return (
    value.status === "synced" &&
    finiteNumber(value.pushed) &&
    finiteNumber(value.pulled) &&
    finiteNumber(value.at) &&
    finiteNumber(value.generation)
  );
}

function wipeResult(value: unknown): value is CloudWipeResult {
  return (
    record(value) &&
    (value.status === "unconfigured" ||
      (value.status === "wiped" && finiteNumber(value.generation)))
  );
}

function batchResult(value: unknown): value is WhitelistBatchResult {
  return (
    record(value) &&
    finiteNumber(value.added) &&
    finiteNumber(value.skipped) &&
    finiteNumber(value.invalid)
  );
}

function call<T>(
  sendMessage: SendStateMessage,
  command: StateCommand,
  accepts: (value: unknown) => value is T,
): Promise<T> {
  const request = makeStateRequest(command);
  return sendMessage(request).then((response) => {
    const parsed = parseStateResponse(response, request.id, command.type);
    if (!parsed.ok) throw new StateProtocolFailure(parsed.error.code, parsed.error.message);
    if (!accepts(parsed.value))
      throw new StateProtocolFailure("BAD_RESPONSE", "Invalid state response.");
    return parsed.value;
  });
}

/** Runtime client for popup/options/content. Inject sendMessage in tests. */
export function createRuntimeStateClient({
  sendMessage,
}: {
  sendMessage: SendStateMessage;
}): StateClient {
  return {
    ledger: {
      hasActiveHandle: (handle) =>
        call(
          sendMessage,
          { type: "ledger.hasActiveHandle", handle },
          (value): value is boolean => typeof value === "boolean",
        ),
      record: (input) => call(sendMessage, { type: "ledger.record", input }, blockedAccount),
      list: () =>
        call(
          sendMessage,
          { type: "ledger.list" },
          (value): value is BlockedAccount[] => Array.isArray(value) && value.every(blockedAccount),
        ),
      stats: () => call(sendMessage, { type: "ledger.stats" }, stats),
      pending: () => call(sendMessage, { type: "ledger.pending" }, pending),
    },
    whitelist: {
      list: () =>
        call(
          sendMessage,
          { type: "whitelist.list" },
          (value): value is string[] =>
            Array.isArray(value) && value.every((entry) => typeof entry === "string"),
        ),
      add: (handle) =>
        call(
          sendMessage,
          { type: "whitelist.add", handle },
          (value): value is WhitelistAddResult =>
            value === "added" || value === "error" || value === "exists" || value === "invalid",
        ),
      remove: (handle) =>
        call(
          sendMessage,
          { type: "whitelist.remove", handle },
          (value): value is void => value === undefined,
        ),
      addMany: (handles) => call(sendMessage, { type: "whitelist.addMany", handles }, batchResult),
    },
    settings: {
      read: () => call(sendMessage, { type: "settings.read" }, settings),
      update: (patch) => call(sendMessage, { type: "settings.update", patch }, settings),
    },
    cloud: {
      inspect: () => call(sendMessage, { type: "cloud.inspect" }, inspection),
      setEnabled: (enabled) =>
        call(
          sendMessage,
          { type: "cloud.setEnabled", enabled },
          (value): value is void => value === undefined,
        ),
      sync: (mode) => call(sendMessage, { type: "cloud.sync", mode }, syncResult),
      wipe: (wipeId) => call(sendMessage, { type: "cloud.wipe", wipeId }, wipeResult),
    },
  };
}

export type { StateResponse };
