// Local store of blocked / muted X accounts, persisted in chrome.storage.local.
//
// This is the source of truth for the extension's hot path: the block loop reads and
// writes here with no network involved. The optional Convex cloud backup
// (`convex-sync.ts`) is a thin layer on top that drains the outbox this store keeps.
//
// Storage layout (all under chrome.storage.local):
//   - `blockedAccounts`:          Record<key, BlockedAccount>  (object map, O(1) lookup)
//   - `blockedOutbox:<actionId>`: OutboxItem                   (one key per action waiting
//     to sync to cloud; per-item keys keep the outbox cross-context safe — see the
//     mutation-chain note in createBlockedStore)
//   - `blockedOutbox`:            OutboxItem[]                 (legacy array from older
//     builds; folded into per-item keys the first time pending() reads it)

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
// One storage key per queued outbox action ("blockedOutbox:<actionId>"). Inserting a
// new item and removing a synced one therefore touch DIFFERENT keys and commute across
// JS contexts, which is what makes markSynced safe against a concurrent record().
const OUTBOX_PREFIX = "blockedOutbox:";
// Pre-per-item builds stored the whole outbox as one array under this key; pending()
// migrates it forward and nothing writes it anymore.
const LEGACY_OUTBOX_KEY = "blockedOutbox";

function outboxKeyFor(actionId: string): string {
  return OUTBOX_PREFIX + actionId;
}

type AccountMap = Record<string, BlockedAccount>;

/** One queued action awaiting a push to the cloud backup. */
export type OutboxItem = {
  accountKey: string;
  xUserId?: string;
  handle: string;
  idUnknown: boolean;
  action: BlockAction;
  /** Enqueue tiebreaker for same-millisecond actions: a per-context counter (contexts
   *  restart at 0, so `action.at` stays the primary sort key). */
  seq?: number;
};

// Per-context enqueue counter behind OutboxItem.seq.
let outboxSeq = 0;

/** FIFO-restoring order for per-item outbox keys: by action time, then by the enqueue
 *  counter. Array sorts are stable, so cross-context ties keep their snapshot order. */
function compareOutboxItems(a: OutboxItem, b: OutboxItem): number {
  return a.action.at - b.action.at || (a.seq ?? 0) - (b.seq ?? 0);
}

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

/** Read the whole storage area. Same annotation trick as readKey: the result is
 *  inherently untyped, and callers must only trust values under keys they own
 *  (pending() filters by the outbox prefix). A failed read degrades to empty. */
function readAll<T>(): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (result: Record<string, T> | undefined) => {
      resolve(result ?? {});
    });
  });
}

function writeKeys(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function removeKeys(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").trim().toLowerCase();
}

function isAccountMap(value: unknown): value is AccountMap {
  return typeof value === "object" && value !== null;
}

export function createBlockedStore(): BlockedStore {
  // chrome.storage has no transactions, so ACCOUNTS_KEY read-modify-write mutations
  // (record, mergeRemote) are serialized through this chain; concurrent calls queue
  // instead of racing (XB-BUG-08 family). The chain is advanced by a settled
  // (never-rejecting) promise so one failed mutation cannot wedge it.
  //
  // SCOPE: the chain serializes only WITHIN one JS context. `blockedStore` is a
  // per-context singleton, and the sync side (popup or background service worker,
  // running markSynced/mergeRemote) and the content script (running record) are
  // separate contexts whose singletons interleave freely. Cross-context safety is
  // therefore provided per structure, not by the chain:
  //   - Outbox (XB-BUG-09, fixed): safe by construction. Every queued action lives
  //     under its own key (`blockedOutbox:<actionId>`); record() only ever inserts a
  //     fresh key, and markSynced() only removes exactly the keys whose ids the cloud
  //     confirmed. Inserts and removes of distinct keys commute, so a record() landing
  //     in the middle of another context's sync can no longer be dropped. (The old
  //     scheme kept ONE array that markSynced read-filtered-wrote — the sync path DID
  //     write the outbox — so an item appended between that read and write was
  //     silently lost and its action never reached the cloud backup.)
  //   - ACCOUNTS_KEY: still a single read-modify-write map, so a sync-side mergeRemote
  //     and a content-script record can lose-update each other's map entry. That stays
  //     harmless: the action itself is safe in the outbox, no live app code reads the
  //     map on the block hot path, and a momentarily-stale entry self-heals on the
  //     next cloud pull. A real fix (re-read-and-revalidate inside writeKeys) becomes
  //     necessary only if stats/list/hasActiveHandle/onChange get wired into decisions
  //     that cannot tolerate one stale read.
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

        // The queued action gets its own storage key, so this insert commutes with a
        // concurrent markSynced() in another context (see the chain note above).
        const writes: Record<string, unknown> = { [ACCOUNTS_KEY]: map };
        const lastAction = merged.actions[merged.actions.length - 1];
        if (lastAction) {
          const item: OutboxItem = {
            accountKey: storeKey,
            ...(merged.xUserId ? { xUserId: merged.xUserId } : {}),
            handle: merged.handle,
            idUnknown: merged.idUnknown,
            action: lastAction,
            seq: ++outboxSeq,
          };
          writes[outboxKeyFor(lastAction.actionId)] = item;
        }

        await writeKeys(writes);
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
      // One key per item, so enumerate by prefix. get(null) is fine at this scale:
      // pending() runs on the popup/sync cadence, never on the block hot path.
      const all = await readAll<OutboxItem | OutboxItem[]>();
      const items: OutboxItem[] = [];
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(OUTBOX_PREFIX) && !Array.isArray(value)) items.push(value);
      }

      // Migrate a legacy array-format outbox forward: give its items per-item keys
      // (skipping any a crashed earlier migration already wrote), then drop the array.
      // Concurrent migrations write identical keys/values, so this is idempotent; the
      // worst interleaving briefly re-queues an already-synced item, which the cloud
      // dedupes by clientActionId and the next markSynced removes again.
      const legacy = all[LEGACY_OUTBOX_KEY];
      if (Array.isArray(legacy) && legacy.length > 0) {
        const writes: Record<string, unknown> = {};
        for (const [index, item] of legacy.entries()) {
          const migrated: OutboxItem = { ...item, seq: item.seq ?? index };
          writes[outboxKeyFor(item.action.actionId)] = migrated;
          if (!items.some((queued) => queued.action.actionId === item.action.actionId)) {
            items.push(migrated);
          }
        }
        await writeKeys(writes);
        await removeKeys([LEGACY_OUTBOX_KEY]);
      }

      return items.toSorted(compareOutboxItems);
    },

    async markSynced(actionIds) {
      if (actionIds.length === 0) return;
      // A pure remove of exactly the synced items' keys: no read-modify-write, so a
      // record() landing concurrently — in this or any other context — inserts a
      // different key and cannot be clobbered (XB-BUG-09).
      await removeKeys(actionIds.map(outboxKeyFor));
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
