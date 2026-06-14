// Local store of blocked / muted X accounts, persisted in chrome.storage.local.
//
// This is the source of truth for the extension's hot path: the block loop reads and
// writes here with no network involved. The optional Convex cloud backup
// (`convex-sync.ts`) is a thin layer on top that drains the outbox this store keeps.
//
// Storage layout (all under chrome.storage.local):
//   - `blockedAccounts`: Record<key, BlockedAccount>   (object map, O(1) lookup)
//   - `blockedOutbox`:   OutboxItem[]                  (actions waiting to sync to cloud)

import {
  accountKeyFor,
  mergeBlockedAccount,
  summarizeAccounts,
  type BlockAction,
  type BlockActionKind,
  type BlockedAccount,
  type BlockedStats,
  type BlockedStatus,
  type BlockSource,
  type RecordInput,
} from "./blocked-merge";

const ACCOUNTS_KEY = "blockedAccounts";
const OUTBOX_KEY = "blockedOutbox";

type AccountMap = Record<string, BlockedAccount>;

/** One queued action awaiting a push to the cloud backup. */
export type OutboxItem = {
  accountKey: string;
  xUserId?: string;
  handle: string;
  idUnknown: boolean;
  action: BlockAction;
};

/** Arguments for the Convex `recordAction` mutation. Built by `outboxItemToRecordArgs`
 *  (kept here, not in convex-sync.ts, so the pure mapping is unit-tested). */
export type RecordActionArgs = {
  xUserId: string;
  handle: string;
  idUnknown: boolean;
  kind: BlockActionKind;
  at: number;
  source: BlockSource;
  clientActionId: string;
  fromAccount?: string;
  // The account's prior "@handle" key, sent only once a numeric id is learned, so the
  // cloud can fold a legacy handle-keyed row into the numeric one (one row per person).
  aliasKey?: string;
};

/**
 * Map a queued outbox item to the cloud `recordAction` arguments.
 *
 * The cloud row is keyed by the account's stable key: the numeric id once known,
 * otherwise "@handle". `aliasKey` carries the original "@handle" key whenever it differs
 * from the canonical key, which only happens after an id is learned for a handle-first
 * account — letting the cloud migrate the old row instead of creating a duplicate.
 */
export function outboxItemToRecordArgs(item: OutboxItem): RecordActionArgs {
  const xUserId = item.xUserId ?? item.accountKey;
  return {
    xUserId,
    handle: item.handle,
    idUnknown: item.idUnknown,
    kind: item.action.kind,
    at: item.action.at,
    source: item.action.source,
    clientActionId: item.action.actionId,
    ...(item.action.fromAccount ? { fromAccount: item.action.fromAccount } : {}),
    ...(item.accountKey !== xUserId ? { aliasKey: item.accountKey } : {}),
  };
}

/** Shape returned by the Convex `listBlocked` query, merged back in on pull. */
export type RemoteAccount = {
  xUserId: string;
  handle: string;
  idUnknown: boolean;
  firstActionAt: number;
  lastActionAt: number;
  blockCount: number;
  muteCount: number;
  status: BlockedStatus;
};

export interface BlockedStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<BlockedAccount | undefined>;
  /** Best-effort reuse check by screen name (used before a block, when no id is known yet). */
  hasActiveHandle(handle: string): Promise<boolean>;
  record(input: RecordInput): Promise<BlockedAccount>;
  list(): Promise<BlockedAccount[]>;
  stats(): Promise<BlockedStats>;
  /** Actions not yet confirmed synced to the cloud. */
  pending(): Promise<OutboxItem[]>;
  /** Drop outbox entries whose action ids the cloud has now accepted. */
  markSynced(actionIds: string[]): Promise<void>;
  /** Union remote accounts into the local map (cloud pull). */
  mergeRemote(remote: RemoteAccount[]): Promise<void>;
  /** Subscribe to account changes; returns an unsubscribe function. */
  onChange(callback: (stats: BlockedStats) => void): () => void;
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readKey<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    // Annotate the (inherently untyped) storage result so the value flows out as T
    // without an unsafe assertion.
    chrome.storage.local.get(key, (result: { [storageKey: string]: T | undefined }) => {
      resolve(result[key]);
    });
  });
}

function writeKeys(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").trim().toLowerCase();
}

function isAccountMap(value: unknown): value is AccountMap {
  return typeof value === "object" && value !== null;
}

export function createBlockedStore(): BlockedStore {
  async function loadMap(): Promise<AccountMap> {
    return (await readKey<AccountMap>(ACCOUNTS_KEY)) ?? {};
  }

  /** Locate an existing record for `input`, tolerating handle-keyed records that
   *  predate us learning a numeric id. */
  function findExistingKey(map: AccountMap, input: RecordInput): string | undefined {
    const directKey = accountKeyFor(input);
    if (directKey in map) return directKey;

    if (input.xUserId) {
      const handleKey = accountKeyFor({ handle: input.handle });
      if (handleKey in map) return handleKey;
      for (const [key, account] of Object.entries(map)) {
        if (account.xUserId === input.xUserId) return key;
      }
    }
    return undefined;
  }

  return {
    async has(key) {
      const map = await loadMap();
      return key in map;
    },

    async get(key) {
      const map = await loadMap();
      return map[key];
    },

    async hasActiveHandle(handle) {
      const needle = normalizeHandle(handle);
      const map = await loadMap();
      return Object.values(map).some(
        (account) => account.status === "active" && normalizeHandle(account.handle) === needle,
      );
    },

    async record(input) {
      const map = await loadMap();
      const existingKey = findExistingKey(map, input);
      const existing = existingKey ? map[existingKey] : undefined;
      const merged = mergeBlockedAccount(existing, input, Date.now(), genId);
      const storeKey = existingKey ?? merged.key;
      map[storeKey] = merged;

      const lastAction = merged.actions[merged.actions.length - 1];
      const outbox = (await readKey<OutboxItem[]>(OUTBOX_KEY)) ?? [];
      if (lastAction) {
        outbox.push({
          accountKey: storeKey,
          ...(merged.xUserId ? { xUserId: merged.xUserId } : {}),
          handle: merged.handle,
          idUnknown: merged.idUnknown,
          action: lastAction,
        });
      }

      await writeKeys({ [ACCOUNTS_KEY]: map, [OUTBOX_KEY]: outbox });
      return merged;
    },

    async list() {
      const map = await loadMap();
      return Object.values(map);
    },

    async stats() {
      const map = await loadMap();
      return summarizeAccounts(Object.values(map));
    },

    async pending() {
      return (await readKey<OutboxItem[]>(OUTBOX_KEY)) ?? [];
    },

    async markSynced(actionIds) {
      if (actionIds.length === 0) return;
      const done = new Set(actionIds);
      const outbox = (await readKey<OutboxItem[]>(OUTBOX_KEY)) ?? [];
      const remaining = outbox.filter((item) => !done.has(item.action.actionId));
      await writeKeys({ [OUTBOX_KEY]: remaining });
    },

    async mergeRemote(remote) {
      if (remote.length === 0) return;
      const map = await loadMap();
      let changed = false;

      for (const row of remote) {
        const key = accountKeyFor({ xUserId: row.xUserId, handle: row.handle });
        let localKey = key in map ? key : undefined;
        if (!localKey) {
          for (const [candidate, account] of Object.entries(map)) {
            if (account.xUserId === row.xUserId) {
              localKey = candidate;
              break;
            }
          }
        }
        // Correlate a still-handle-keyed local record (id unknown) with a remote row that
        // now carries the id, by screen name — so an id learned on another device folds in
        // here instead of creating a duplicate account.
        if (!localKey && !row.idUnknown) {
          const needle = normalizeHandle(row.handle);
          for (const [candidate, account] of Object.entries(map)) {
            if (account.idUnknown && normalizeHandle(account.handle) === needle) {
              localKey = candidate;
              break;
            }
          }
        }

        if (!localKey) {
          map[key] = {
            key,
            handle: row.handle,
            idUnknown: row.idUnknown,
            // A handle-keyed cloud row stores "@handle" in xUserId as its key; locally
            // that is not a real id, so only keep xUserId when the id is actually known.
            ...(!row.idUnknown && row.xUserId ? { xUserId: row.xUserId } : {}),
            firstActionAt: row.firstActionAt,
            lastActionAt: row.lastActionAt,
            blockCount: row.blockCount,
            muteCount: row.muteCount,
            status: row.status,
            actions: [],
          };
          changed = true;
          continue;
        }

        const local = map[localKey];
        if (!local) continue;
        const remoteNewer = row.lastActionAt > local.lastActionAt;
        // Adopt a numeric id learned remotely, and stop treating the account as
        // id-unknown once either side knows the id (mirrors the cloud's AND rule).
        const learnedId = local.xUserId ?? (row.idUnknown ? undefined : row.xUserId);
        map[localKey] = {
          ...local,
          handle: remoteNewer ? row.handle : local.handle,
          idUnknown: local.idUnknown && row.idUnknown,
          ...(learnedId ? { xUserId: learnedId } : {}),
          firstActionAt: Math.min(local.firstActionAt, row.firstActionAt),
          lastActionAt: Math.max(local.lastActionAt, row.lastActionAt),
          blockCount: Math.max(local.blockCount, row.blockCount),
          muteCount: Math.max(local.muteCount, row.muteCount),
          status: remoteNewer ? row.status : local.status,
        };
        changed = true;
      }

      if (changed) await writeKeys({ [ACCOUNTS_KEY]: map });
    },

    onChange(callback) {
      const onChanged = chrome.storage?.onChanged;
      if (!onChanged || typeof onChanged.addListener !== "function") {
        return () => {};
      }
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        const change = changes[ACCOUNTS_KEY];
        if (areaName !== "local" || !change) return;
        const accounts = isAccountMap(change.newValue) ? Object.values(change.newValue) : [];
        callback(summarizeAccounts(accounts));
      };
      onChanged.addListener(listener);
      return () => onChanged.removeListener(listener);
    },
  };
}

/** Shared singleton for app code. */
export const blockedStore = createBlockedStore();
