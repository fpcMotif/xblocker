// Unified whitelist persistence, ported from content/actions.ts (that copy stays put
// until its owner re-points its imports here).
//
// readWhitelist below reads via a raw chrome.storage.local.get rather than
// chrome-storage.ts's storageGet: storageGet's tolerant contract collapses "the key was
// never set" and "the get itself failed" into the same `undefined`, but
// addToWhitelist/removeFromWhitelist need to tell those two apart — a failed read must
// abort the mutation, not treat an unreadable (possibly non-empty) whitelist as empty
// and clobber it with just the new entry (XB-BUG-08 family). The write side has no such
// ambiguity, so saveWhitelist reuses storageSet and the shared WHITELIST_KEY constant.
//
// Cloud sync: every mutation that changes the list also queues one outbox entry per
// change under its own key (`whitelistOutbox:<actionId>`) IN THE SAME storage.set, so
// the queued sync event can never be lost to a cross-context clobber of the list alone
// (the self-healing argument in blocked-store.ts applies verbatim). No writer ever
// read-modify-writes the outbox: a mutation adds keys and markSynced removes them, so
// the sync contexts (popup, options, worker) can never write back a stale copy that
// erases an entry the content script queued meanwhile. The legacy `whitelistOutbox`
// array is still read and drained, never appended. The outbox is drained by the sync
// engine's push/markSynced and consulted by mergeRemote; the pure fold/reconcile logic
// lives in whitelist-merge.ts, shared with the Convex handler per ADR-0002's pattern.
//
// Each JS context gets its own store (and mutation chain) from createWhitelistStore;
// the module-level functions below are the default instance's.

import { storageGetAll, storageRemove, storageSet, WHITELIST_KEY } from "./chrome-storage";
import {
  reconcileWhitelist,
  type RemoteWhitelistEntry,
  type WhitelistEntryStatus,
  type WhitelistOutboxItem,
} from "./whitelist-merge";
import { normalizeUsername } from "./settings";

export type { RemoteWhitelistEntry, WhitelistEntryStatus, WhitelistOutboxItem };

export type WhitelistAddResult = "added" | "error" | "exists" | "invalid";

const LEGACY_OUTBOX_KEY = "whitelistOutbox";
const OUTBOX_ITEM_PREFIX = `${LEGACY_OUTBOX_KEY}:`;

/** The legacy outbox array's storage key. */
export const WHITELIST_OUTBOX_STORAGE_KEY = LEGACY_OUTBOX_KEY;

/** The storage key that holds one queued whitelist change. */
export function whitelistOutboxItemKey(actionId: string): string {
  return `${OUTBOX_ITEM_PREFIX}${actionId}`;
}

/** Whether a chrome.storage key belongs to the whitelist outbox, so the background
 *  worker can watch it (a queued change is the signal that a sync is worth scheduling). */
export function isWhitelistOutboxStorageKey(key: string): boolean {
  return key === LEGACY_OUTBOX_KEY || key.startsWith(OUTBOX_ITEM_PREFIX);
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type WhitelistRead = { ok: boolean; whitelist: string[] };

function readWhitelist(): Promise<WhitelistRead> {
  return new Promise((resolve) => {
    chrome.storage.local.get(WHITELIST_KEY, (result) => {
      if (result === undefined) {
        resolve({ ok: false, whitelist: [] });
        return;
      }
      const stored = result[WHITELIST_KEY];
      resolve({ ok: true, whitelist: Array.isArray(stored) ? stored : [] });
    });
  });
}

function isOutboxItem(value: unknown): value is WhitelistOutboxItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "handle" in value &&
    typeof value.handle === "string" &&
    "actionId" in value &&
    typeof value.actionId === "string"
  );
}

type OutboxRead = { ok: boolean; outbox: WhitelistOutboxItem[]; legacy: WhitelistOutboxItem[] };

// Same strict-read contract as readWhitelist: a failed get must abort the mutation
// instead of letting a decision made from "looks empty" drop still-pending entries.
async function readOutbox(): Promise<OutboxRead> {
  let all: Record<string, unknown>;
  try {
    all = await storageGetAll();
  } catch {
    return { ok: false, outbox: [], legacy: [] };
  }
  const stored = all[LEGACY_OUTBOX_KEY];
  const legacy = Array.isArray(stored) ? stored.filter(isOutboxItem) : [];
  const keyed = Object.entries(all)
    .filter(([key]) => key.startsWith(OUTBOX_ITEM_PREFIX))
    .map(([, value]) => value)
    .filter(isOutboxItem)
    .toSorted((a, b) => a.at - b.at);
  return { ok: true, outbox: [...legacy, ...keyed], legacy };
}

export function getWhitelist(): Promise<string[]> {
  return readWhitelist().then((read) => read.whitelist);
}

// X handles are case-insensitive.
function matchesHandle(entry: string, username: string): boolean {
  return entry.toLowerCase() === username.toLowerCase();
}

export async function isWhitelisted(username: string): Promise<boolean> {
  const whitelist = await getWhitelist();
  return whitelist.some((entry) => matchesHandle(entry, username));
}

function makeOutboxItem(handle: string, status: WhitelistEntryStatus): WhitelistOutboxItem {
  return { handle, status, at: Date.now(), actionId: genId() };
}

/** One storage.set carrying the new list and one key per queued change. */
function listAndOutboxWrite(
  whitelist: string[],
  items: WhitelistOutboxItem[],
): Record<string, unknown> {
  const write: Record<string, unknown> = { [WHITELIST_KEY]: whitelist };
  for (const item of items) write[whitelistOutboxItemKey(item.actionId)] = item;
  return write;
}

export type WhitelistBatchResult = { added: number; skipped: number; invalid: number };

// Function-typed properties, not methods: app code destructures the default instance,
// and none of these use `this`.
export type WhitelistStore = {
  addToWhitelist: (username: string) => Promise<WhitelistAddResult>;
  removeFromWhitelist: (username: string) => Promise<void>;
  /** Batched counterpart to addToWhitelist: one read, one write, for an entire list of
   *  handles — used by import so a large file doesn't pay a per-item read-modify-write
   *  (O(n^2) against a growing list) and so the mutation queues as a single unit instead
   *  of N separately-enqueued ones. Dedup is case-insensitive, both against the existing
   *  whitelist and within the batch itself (first occurrence of a handle wins). */
  addManyToWhitelist: (handles: string[]) => Promise<WhitelistBatchResult>;
  /** Changes not yet confirmed synced to the cloud. Strict like blocked-store's
   *  pending(): a failed read rejects rather than reporting an empty queue. */
  pendingWhitelistOutbox: () => Promise<WhitelistOutboxItem[]>;
  /** Drop outbox entries whose action ids the cloud has now accepted. */
  markWhitelistSynced: (actionIds: string[]) => Promise<void>;
  /** Reconcile the local whitelist with a cloud pull (true-set merge: remote `active`
   *  rows union in, remote `removed` rows drop local entries, still-pending local
   *  changes win by timestamp). Writes only the list, never the outbox — the self-
   *  healing argument in blocked-store.ts's mergeRemote applies verbatim. */
  mergeRemoteWhitelist: (remote: RemoteWhitelistEntry[]) => Promise<void>;
  /**
   * First-sync backfill: treat every handle already in the local whitelist as a pending
   * "active" change. The engine calls this when the whitelist collection has no prior
   * lastSyncAt, so upgrading with an existing local-only whitelist pushes it to the
   * cloud on first sync instead of looking like the cloud copy (empty) wiped it.
   * Idempotent: handles already queued are skipped.
   */
  backfillWhitelistOutbox: () => Promise<void>;
};

export function createWhitelistStore(): WhitelistStore {
  // chrome.storage has no transactions, so whitelist read-modify-writes are
  // serialized through this chain; concurrent mutations queue instead of racing.
  // SCOPE: one JS context, like blocked-store's chain.
  let mutationChain: Promise<unknown> = Promise.resolve();

  function enqueueMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const run = mutationChain.then(mutate);
    // The chain itself must swallow rejections so one failed mutation doesn't
    // wedge every later one; callers still see the rejection through `run`.
    mutationChain = run.catch(() => undefined);
    return run;
  }

  return {
    addToWhitelist(username) {
      const normalized = normalizeUsername(username);
      if (!normalized) {
        return Promise.resolve("invalid");
      }
      return enqueueMutation(async () => {
        const read = await readWhitelist();
        // A failed read looks like an empty list; saving would clobber the
        // stored whitelist, so abort instead.
        if (!read.ok) {
          return "error";
        }
        if (read.whitelist.some((entry) => matchesHandle(entry, normalized))) {
          return "exists";
        }
        await storageSet(
          listAndOutboxWrite(
            [...read.whitelist, normalized],
            [makeOutboxItem(normalized, "active")],
          ),
        );
        return "added";
      });
    },

    removeFromWhitelist(username) {
      return enqueueMutation(async () => {
        const read = await readWhitelist();
        if (!read.ok) {
          return;
        }
        const next = read.whitelist.filter((entry) => !matchesHandle(entry, username));
        if (next.length === read.whitelist.length) {
          // Nothing matched: no sync event to queue, just the historical rewrite.
          await storageSet({ [WHITELIST_KEY]: next });
          return;
        }
        // Queue the removal as a status flip, so it propagates to other devices on
        // push/pull instead of looking like "never whitelisted" (ADR-0002 precedent).
        const removedEntry =
          read.whitelist.find((entry) => matchesHandle(entry, username)) ?? username;
        await storageSet(listAndOutboxWrite(next, [makeOutboxItem(removedEntry, "removed")]));
      });
    },

    addManyToWhitelist(handles) {
      return enqueueMutation(async () => {
        const read = await readWhitelist();
        // A failed read looks like an empty list; writing would clobber the stored
        // whitelist, so abort (same hazard as addToWhitelist's single-item read).
        if (!read.ok) {
          return { added: 0, skipped: 0, invalid: 0 };
        }

        const existingLower = new Set(read.whitelist.map((entry) => entry.toLowerCase()));
        const seenLower = new Set<string>();
        const toAdd: string[] = [];
        let skipped = 0;
        let invalid = 0;

        for (const raw of handles) {
          const normalized = normalizeUsername(raw);
          if (!normalized) {
            invalid++;
            continue;
          }
          const lower = normalized.toLowerCase();
          if (existingLower.has(lower) || seenLower.has(lower)) {
            skipped++;
            continue;
          }
          seenLower.add(lower);
          toAdd.push(normalized);
        }

        if (toAdd.length > 0) {
          // One queued "active" entry per added handle, in the SAME write as the list —
          // the sync engine's batched push turns them into chunked round-trips, so a
          // large import never pays a per-handle cloud write.
          await storageSet(
            listAndOutboxWrite(
              [...read.whitelist, ...toAdd],
              toAdd.map((handle) => makeOutboxItem(handle, "active")),
            ),
          );
        }
        return { added: toAdd.length, skipped, invalid };
      });
    },

    // --- Cloud-sync port -------------------------------------------------------
    //
    // The shape below mirrors BlockedStore's pending/markSynced/mergeRemote so the
    // generic sync engine (packages/sync/sync-engine.ts) drives the whitelist through
    // the same port as the blocklist. The content script only ever WRITES the outbox
    // (via the mutations above); pushing/pulling runs in the popup and background
    // worker, keeping *.convex.cloud traffic out of x.com's page context.

    async pendingWhitelistOutbox() {
      const read = await readOutbox();
      if (!read.ok) {
        throw new Error("Failed to read the whitelist outbox.");
      }
      return read.outbox;
    },

    markWhitelistSynced(actionIds) {
      if (actionIds.length === 0) return Promise.resolve();
      return enqueueMutation(async () => {
        await storageRemove(actionIds.map(whitelistOutboxItemKey));
        // Only the legacy array still needs a read-modify-write. Nothing appends to it
        // any more, so a stale copy can only resurrect an entry (a harmless re-push).
        const read = await readOutbox();
        const done = new Set(actionIds);
        if (read.ok && read.legacy.some((item) => done.has(item.actionId))) {
          await storageSet({
            [LEGACY_OUTBOX_KEY]: read.legacy.filter((item) => !done.has(item.actionId)),
          });
        }
      });
    },

    mergeRemoteWhitelist(remote) {
      if (remote.length === 0) return Promise.resolve();
      return enqueueMutation(async () => {
        const read = await readWhitelist();
        if (!read.ok) return;
        const outbox = await readOutbox();
        if (!outbox.ok) return;
        const next = reconcileWhitelist(read.whitelist, remote, outbox.outbox);
        const unchanged =
          next.length === read.whitelist.length &&
          next.every((handle, i) => handle === read.whitelist[i]);
        if (unchanged) return;
        await storageSet({ [WHITELIST_KEY]: next });
      });
    },

    backfillWhitelistOutbox() {
      return enqueueMutation(async () => {
        const read = await readWhitelist();
        if (!read.ok) return;
        const outbox = await readOutbox();
        if (!outbox.ok) return;
        const queued = new Set(outbox.outbox.map((item) => item.handle.toLowerCase()));
        const additions = read.whitelist
          .filter((handle) => !queued.has(handle.toLowerCase()))
          .map((handle) => makeOutboxItem(handle, "active"));
        if (additions.length === 0) return;
        const write: Record<string, unknown> = {};
        for (const item of additions) write[whitelistOutboxItemKey(item.actionId)] = item;
        await storageSet(write);
      });
    },
  };
}

/** Shared default instance for app code. */
export const whitelistStore = createWhitelistStore();

export const {
  addToWhitelist,
  removeFromWhitelist,
  addManyToWhitelist,
  pendingWhitelistOutbox,
  markWhitelistSynced,
  mergeRemoteWhitelist,
  backfillWhitelistOutbox,
} = whitelistStore;
