# Plan 003: Reading the sync outbox loads only the outbox keys

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- packages/storage/chrome-storage.ts packages/storage/blocked-store.ts packages/storage/whitelist-store.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. The excerpts under "Current
> state" are the authority. If the live code does not match them, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

To find the queued sync actions (the "outbox"), both stores read the entire `chrome.storage.local` area, which includes the whole blocked list. This plan lists the storage keys first and then reads only the outbox keys. The outbox contents, their order, and the strict "a failed read is an error, not an empty outbox" rule stay unchanged.

## Why this matters

The outbox keeps one storage key per queued action. Finding those keys today uses `chrome.storage.local.get(null)`, which copies every stored value into the caller's memory. The background worker's sync gate does this for both collections on every wake only to take `.length`. A sync that runs repeats it about seven times. With tens of thousands of blocked accounts, each read copies megabytes into the service worker. After this plan, those reads cost in proportion to the outbox, which is usually empty or small.

## Current state

- `packages/storage/chrome-storage.ts` — the promise wrappers around `chrome.storage.local`. `storageGetAll()` is at lines 60-70.
- `packages/storage/blocked-store.ts` — blocked-accounts store. `readOutbox` at lines 63-75, `pending` at 253-255, `markSynced` at 257-271.
- `packages/storage/whitelist-store.ts` — whitelist store. `readOutbox` at lines 93-108, used by `pendingWhitelistOutbox`, `markWhitelistSynced`, `mergeRemoteWhitelist`, `backfillWhitelistOutbox`.
- `packages/sync/sync-engine.ts:281-287` — the gate that calls `pending()` for each collection only to read `.length`. It needs no change: it gets cheaper when `pending()` does.
- `test/setup.ts` — the chrome fake. Its `chrome.storage.local` has `get`, `set`, `remove`, `clear`. It has no `getKeys`.

`packages/storage/chrome-storage.ts:60-70` today:

```ts
export function storageGetAll(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (result: Record<string, unknown> | undefined) => {
      if (result === undefined || chrome.runtime.lastError) {
        reject(new Error("chrome.storage.local read failed"));
        return;
      }
      resolve(result);
    });
  });
}
```

`packages/storage/blocked-store.ts:63-75` today:

```ts
function readOutbox(all: Record<string, unknown>): {
  items: OutboxItem[];
  legacy: OutboxItem[];
} {
  const stored = all[LEGACY_OUTBOX_KEY];
  const legacy = Array.isArray(stored) ? stored.filter(isOutboxItem) : [];
  const keyed = Object.entries(all)
    .filter(([key]) => key.startsWith(OUTBOX_ITEM_PREFIX))
    .map(([, value]) => value)
    .filter(isOutboxItem)
    .toSorted((a, b) => a.action.at - b.action.at);
  return { items: [...legacy, ...keyed], legacy };
}
```

`packages/storage/blocked-store.ts:253-271` today:

```ts
    async pending() {
      return readOutbox(await storageGetAll()).items;
    },

    markSynced(actionIds) {
      if (actionIds.length === 0) return Promise.resolve();
      return enqueueMutation(async () => {
        await storageRemove(actionIds.map(outboxItemKey));
        // Only the legacy array still needs a read-modify-write. Nothing appends to it
        // any more, so a stale copy can only resurrect an item (a harmless re-push).
        const { legacy } = readOutbox(await storageGetAll());
        const done = new Set(actionIds);
        if (legacy.some((item) => done.has(item.action.actionId))) {
          await storageSet({
            [LEGACY_OUTBOX_KEY]: legacy.filter((item) => !done.has(item.action.actionId)),
          });
        }
      });
    },
```

`packages/storage/whitelist-store.ts:93-108` today:

```ts
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
```

Facts about the Chrome API:

- `chrome.storage.local.getKeys(callback)` returns every key name without the values. It exists from Chrome 130. `node_modules/@types/chrome/index.d.ts` declares it. The manifest sets no minimum Chrome version, so the code must fall back when `getKeys` is missing.
- `chrome.storage.local.get(keys: string[], callback)` returns only the listed keys.

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. A comment may leave only together with the code it describes.
- Do not add lint suppressions or `as` type assertions. The lint gate forbids unsafe assertions; use type predicates as the existing code does.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- `packages/storage` must not import from `packages/sync`.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Boundaries | `bun run lint:boundaries` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test packages/storage` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `packages/storage/chrome-storage.ts`
- `packages/storage/blocked-store.ts` (only `readOutbox`, `pending`, `markSynced`)
- `packages/storage/whitelist-store.ts` (only `readOutbox`)
- `packages/storage/tests/chrome-storage.test.ts`
- `packages/storage/tests/blocked-store.test.ts`
- `packages/storage/tests/whitelist-store.test.ts`

**Out of scope** (do NOT touch):

- `packages/sync/**` — callers keep calling `pending()`; no interface changes.
- `test/setup.ts` — do not add `getKeys` to the shared fake. Tests that need it install and remove their own stub, so the fallback path stays the default under test.
- The account map layout and `record()` — plan 005 owns those.
- `storageGetAll` itself — keep it exported; other code may still use it.

## Git workflow

- Branch: `advisor/003-read-only-outbox-keys`
- Commit per step is fine. Conventional style, for example `perf(storage): read only outbox keys when listing pending actions`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a strict "read keys by prefix" helper

In `packages/storage/chrome-storage.ts`, add and export:

```ts
export function storageGetByPrefix(
  prefix: string,
  exactKeys: string[] = [],
): Promise<Record<string, unknown>>
```

Behavior:

1. If `chrome.storage.local.getKeys` is a function, call it with a callback. If the callback receives `undefined` or `chrome.runtime.lastError` is set, reject with `new Error("chrome.storage.local read failed")`.
2. From the returned key names, keep those that start with `prefix` or are listed in `exactKeys`.
3. If none match, resolve `{}` without a second storage call.
4. Otherwise call `chrome.storage.local.get(matchingKeys, callback)`. Reject under the same two failure conditions. Resolve the result.
5. If `getKeys` is not a function, call `storageGetAll()` and return only the entries whose key starts with `prefix` or is in `exactKeys`.

Both rejections must go through `reject` inside the callback, as `storageGetAll` does, never a `throw`.

Add tests to `packages/storage/tests/chrome-storage.test.ts`:

- Fallback path (no `getKeys`): returns only matching keys.
- Fast path (install a `getKeys` stub on `chrome.storage.local` for the test, remove it afterwards): returns only matching keys, and the `get` call receives an array of exactly those keys.
- Fast path with no matching keys: resolves `{}` and never calls `get`.
- `getKeys` callback receives `undefined`: rejects.
- `get` fails after `getKeys` succeeded: rejects.

**Verify**: `bun test packages/storage/tests/chrome-storage.test.ts` → all pass.

### Step 2: Use it in the blocked store

In `packages/storage/blocked-store.ts`:

1. `pending()` becomes `readOutbox(await storageGetByPrefix(OUTBOX_ITEM_PREFIX, [LEGACY_OUTBOX_KEY])).items`.
2. In `markSynced`, replace `readOutbox(await storageGetAll())` with the same `storageGetByPrefix(OUTBOX_ITEM_PREFIX, [LEGACY_OUTBOX_KEY])` call. Keep the existing comment above it.
3. `readOutbox` needs no logic change: it already filters by prefix.
4. Remove `storageGetAll` from this file's import list if nothing else in the file uses it.

Add a test to `packages/storage/tests/blocked-store.test.ts`: with a `getKeys` stub installed and 3 accounts plus 2 outbox keys in `storageFake.data`, `pending()` returns the 2 items in `action.at` order and the recorded `get` call did not include `"blockedAccounts"`.

**Verify**: `bun test packages/storage/tests/blocked-store.test.ts` → all pass.

### Step 3: Use it in the whitelist store

In `packages/storage/whitelist-store.ts`, inside `readOutbox`, replace `all = await storageGetAll();` with `all = await storageGetByPrefix(OUTBOX_ITEM_PREFIX, [LEGACY_OUTBOX_KEY]);`. Keep the `try`/`catch` that maps a failure to `{ ok: false, outbox: [], legacy: [] }`. Remove the unused import if `storageGetAll` is no longer used in the file.

Add the matching test to `packages/storage/tests/whitelist-store.test.ts`: with a `getKeys` stub, `pendingWhitelistOutbox()` returns the queued items and the `get` call did not include the `"whitelist"` key.

**Verify**: `bun test packages/storage/tests/whitelist-store.test.ts` → all pass.

### Step 4: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run lint:boundaries` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- Five helper tests in step 1, one store test each in steps 2 and 3.
- Structural pattern for store tests: the existing `pending` / `markSynced` tests in each file (`rg -n "pending\(" packages/storage/tests`).
- The existing strict-read tests (a failed read rejects or reports `ok: false`) must keep passing unchanged. They prove the strictness contract survived.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run lint:boundaries`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the new tests present and passing
- [ ] `rg -n "storageGetAll\(" packages/storage/blocked-store.ts packages/storage/whitelist-store.ts` returns no matches
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The quoted code does not match the live files.
- `chrome.storage.local.getKeys` is not declared in the installed `@types/chrome` (check with `rg -n "getKeys" node_modules/@types/chrome/index.d.ts`).
- Any existing test that asserts a failed outbox read is an error starts failing.
- The typecheck requires an `as` assertion to call `getKeys`. Report it; do not add the assertion.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- On Chrome older than 130 the fallback still reads everything. If a minimum Chrome version is ever set in the manifest, delete the fallback and its tests.
- Plan 005 moves blocked accounts to one key per account under a different prefix. Its `list()` should use this same helper.
- Reviewers: confirm no code path treats a failed read as an empty outbox.
