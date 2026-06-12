import { sameUsername } from "./username";

/**
 * The one owner of the whitelist's storage schema. Every write is a fresh
 * read-modify-write — never a stale snapshot — and writes are serialized,
 * so an edit on one surface can't clobber an edit from another. Surfaces
 * stay live via `onChange`.
 */

const WHITELIST_KEY = "whitelist";

function readWhitelist(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(WHITELIST_KEY, (result) => {
      const stored: unknown = result?.[WHITELIST_KEY];
      resolve(
        Array.isArray(stored)
          ? stored.filter((entry): entry is string => typeof entry === "string")
          : [],
      );
    });
  });
}

function writeWhitelist(whitelist: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [WHITELIST_KEY]: whitelist }, () => resolve());
  });
}

let pendingWrite: Promise<unknown> = Promise.resolve();

function updateWhitelist(mutate: (whitelist: string[]) => string[]): Promise<string[]> {
  const turn = pendingWrite;
  const result = (async () => {
    await turn.catch(() => undefined);
    const current = await readWhitelist();
    const next = mutate(current);
    if (next !== current) {
      await writeWhitelist(next);
    }
    return next;
  })();
  pendingWrite = result.catch(() => undefined);
  return result;
}

export const whitelistStore = {
  list: readWhitelist,

  /** Membership is always a case-insensitive handle comparison. */
  has(whitelist: string[], username: string): boolean {
    return whitelist.some((entry) => sameUsername(entry, username));
  },

  /** Returns false when the handle was already whitelisted. */
  async add(username: string): Promise<boolean> {
    let added = false;
    await updateWhitelist((whitelist) => {
      if (whitelistStore.has(whitelist, username)) {
        return whitelist;
      }
      added = true;
      return [...whitelist, username];
    });
    return added;
  },

  async remove(username: string): Promise<void> {
    await updateWhitelist((whitelist) =>
      whitelist.filter((entry) => !sameUsername(entry, username)),
    );
  },

  /** Fires with the latest whitelist whenever any surface changes it. */
  onChange(listener: (whitelist: string[]) => void): void {
    chrome.storage.onChanged?.addListener((changes, area) => {
      const change = changes[WHITELIST_KEY];
      if (area === "local" && change) {
        listener(Array.isArray(change.newValue) ? change.newValue : []);
      }
    });
  },
};
