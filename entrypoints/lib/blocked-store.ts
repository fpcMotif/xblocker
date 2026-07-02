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
  foldAccountSnapshot,
  mergeBlockedAccount,
  summarizeAccounts,
  type BlockAction,
  type BlockActionKind,
  type BlockedAccount,
  type BlockedStats,
  type BlockSource,
  type RecordInput,
  type RemoteAccountSnapshot,
} from "./blocked-merge";

const ACCOUNTS_KEY = "blockedAccounts";
const OUTBOX_KEY = "blockedOutbox";

/** Storage key of the outbox, exported so the background worker can watch it for
 *  changes (a queued action is the signal that a cloud sync is worth scheduling). */
export const OUTBOX_STORAGE_KEY = OUTBOX_KEY;

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

/** Shape returned by the Convex `listBlocked` query, merged back in on pull. The single
 *  definition lives in blocked-merge alongside the fold that consumes it. */
export type RemoteAccount = RemoteAccountSnapshot;

/** One chunk of outbox items ready for the cloud's batched `recordActions` mutation:
 *  the mapped mutation args plus the action ids to mark synced once accepted, and the
 *  original items so a caller can fall back to per-item pushes. */
export type RecordBatch = {
  args: RecordActionArgs[];
  actionIds: string[];
  items: OutboxItem[];
};

/**
 * Split the outbox into chunks of at most `size` items, each mapped to the batched
 * `recordActions` args. One chunk = one HTTP round-trip and one Convex transaction;
 * pushing item-by-item made sync latency scale linearly with the outbox length
 * (~300ms per queued action). Kept here rather than in convex-sync.ts so the mapping
 * is unit-tested; convex-sync stays a thin I/O wrapper.
 */
export function outboxToRecordBatches(items: OutboxItem[], size: number): RecordBatch[] {
  const chunkSize = Math.max(1, Math.trunc(size));
  const batches: RecordBatch[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    batches.push({
      args: chunk.map(outboxItemToRecordArgs),
      actionIds: chunk.map((item) => item.action.actionId),
      items: chunk,
    });
  }
  return batches;
}

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
  // chrome.storage has no transactions, so read-modify-write mutations are
  // serialized through this chain; concurrent record/markSynced/mergeRemote
  // calls queue instead of racing (XB-BUG-08 family). The chain is advanced by
  // a settled (never-rejecting) promise so one failed mutation cannot wedge it.
  //
  // SCOPE: this serializes only WITHIN one JS context. `blockedStore` is a
  // per-context singleton, and the popup (which runs mergeRemote on a cloud pull)
  // and the content script (which runs record) are separate contexts whose
  // singletons can still lose-update each other on ACCOUNTS_KEY. That is harmless
  // today because (a) the sync path never writes OUTBOX_KEY, so a queued action is
  // never clobbered cross-context (the block itself is already done before record
  // runs, and the outbox re-syncs idempotently), and (b) no live app code reads the
  // account map, so any momentarily-stale stats self-heal on the next pull. A real
  // fix (re-read-and-revalidate ACCOUNTS_KEY inside writeKeys) becomes necessary only
  // if stats/list/hasActiveHandle/onChange get wired into the popup UI, or if the
  // sync path ever also writes OUTBOX_KEY — at which point this turns into a bug.
  let mutationChain: Promise<unknown> = Promise.resolve();

  function enqueueMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const run = mutationChain.then(mutate);
    mutationChain = run.catch(() => undefined);
    return run;
  }

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

    record(input) {
      return enqueueMutation(async () => {
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
      });
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

    markSynced(actionIds) {
      if (actionIds.length === 0) return Promise.resolve();
      return enqueueMutation(async () => {
        const done = new Set(actionIds);
        const outbox = (await readKey<OutboxItem[]>(OUTBOX_KEY)) ?? [];
        const remaining = outbox.filter((item) => !done.has(item.action.actionId));
        await writeKeys({ [OUTBOX_KEY]: remaining });
      });
    },

    mergeRemote(remote) {
      if (remote.length === 0) return Promise.resolve();
      return enqueueMutation(async () => {
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
          // Reconcile the local record with the remote snapshot (pure, unit-tested fold).
          map[localKey] = foldAccountSnapshot(local, row);
          changed = true;
        }

        if (changed) await writeKeys({ [ACCOUNTS_KEY]: map });
      });
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
