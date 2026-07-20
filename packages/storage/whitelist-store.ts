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

import { storageSet, WHITELIST_KEY } from "./chrome-storage";
import { normalizeUsername } from "./settings";

export type WhitelistAddResult = "added" | "error" | "exists" | "invalid";

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

export function getWhitelist(): Promise<string[]> {
  return readWhitelist().then((read) => read.whitelist);
}

function saveWhitelist(whitelist: string[]): Promise<void> {
  return storageSet({ [WHITELIST_KEY]: whitelist });
}

// X handles are case-insensitive.
function matchesHandle(entry: string, username: string): boolean {
  return entry.toLowerCase() === username.toLowerCase();
}

export async function isWhitelisted(username: string): Promise<boolean> {
  const whitelist = await getWhitelist();
  return whitelist.some((entry) => matchesHandle(entry, username));
}

// chrome.storage has no transactions, so whitelist read-modify-writes are
// serialized through this chain; concurrent mutations queue instead of racing.
let whitelistMutationChain: Promise<unknown> = Promise.resolve();

function enqueueWhitelistMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const run = whitelistMutationChain.then(mutate);
  // The chain itself must swallow rejections so one failed mutation doesn't
  // wedge every later one; callers still see the rejection through `run`.
  whitelistMutationChain = run.catch(() => undefined);
  return run;
}

export function addToWhitelist(username: string): Promise<WhitelistAddResult> {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return Promise.resolve("invalid");
  }
  return enqueueWhitelistMutation(async () => {
    const read = await readWhitelist();
    // A failed read looks like an empty list; saving would clobber the
    // stored whitelist, so abort instead.
    if (!read.ok) {
      return "error";
    }
    if (read.whitelist.some((entry) => matchesHandle(entry, normalized))) {
      return "exists";
    }
    await saveWhitelist([...read.whitelist, normalized]);
    return "added";
  });
}

export function removeFromWhitelist(username: string): Promise<void> {
  return enqueueWhitelistMutation(async () => {
    const read = await readWhitelist();
    if (!read.ok) {
      return;
    }
    await saveWhitelist(read.whitelist.filter((entry) => !matchesHandle(entry, username)));
  });
}

export type WhitelistBatchResult = { added: number; skipped: number; invalid: number };

/** Batched counterpart to addToWhitelist: one read, one write, for an entire list of
 *  handles — used by import so a large file doesn't pay a per-item read-modify-write
 *  (O(n^2) against a growing list) and so the mutation queues as a single unit instead
 *  of N separately-enqueued ones. Dedup is case-insensitive, both against the existing
 *  whitelist and within the batch itself (first occurrence of a handle wins). */
export function addManyToWhitelist(handles: string[]): Promise<WhitelistBatchResult> {
  return enqueueWhitelistMutation(async () => {
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
      await saveWhitelist([...read.whitelist, ...toAdd]);
    }
    return { added: toAdd.length, skipped, invalid };
  });
}
