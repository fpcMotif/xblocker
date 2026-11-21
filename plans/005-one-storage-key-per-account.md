# Plan 005: Each blocked account has its own storage key, and one block costs the same at any list size

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- packages/storage/blocked-store.ts packages/storage/chrome-storage.ts entrypoints/popup/main.ts entrypoints/options/panes/blocked-log.ts wxt.config.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. Plans 002 and 003 edit
> `blocked-store.ts` before this one. The differences they introduce are
> listed under "Expected drift" and are not a STOP condition. Any other
> mismatch with the excerpts is.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/002-index-cloud-merge.md, plans/003-read-only-outbox-keys.md
- **Category**: perf
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

All blocked accounts live in one storage key, so every block reads and rewrites the whole list, and Chrome sends the old and new copies of the list to every listening context. This plan stores one key per account plus a small counters key, migrates existing data on first use, and raises the storage quota. The `BlockedAccount` shape, the outbox, the merge arithmetic, and the Convex wire format stay unchanged.

## Why this matters

`chrome.storage.local` has no partial update. Writing one key replaces its whole value, and `chrome.storage.onChanged` delivers both the old and the new value to every context that listens: the background worker, the popup, and the options page. Today a bulk run of 50 blocks on a list of 30,000 accounts serializes the full list 50 times and delivers 100 full copies to each listener. After this plan, one block reads at most three small keys and writes three small keys, whatever the list size.

A second problem is fixed here because it has the same cause. The manifest requests only `storage` and `alarms`, so `chrome.storage.local` is capped at 10 MB. `storageSet` ignores write errors. At roughly 250 bytes per account (an estimate, not a measurement), the list reaches the cap near 30,000-40,000 accounts, and later blocks would be lost silently. The `unlimitedStorage` permission removes the cap and shows no install warning.

## Current state

- `packages/storage/blocked-store.ts` — the store (354 lines). Exports `blockedStore`, `createBlockedStore`, `BlockedStore`, `OutboxItem`, `RemoteAccount`, `OUTBOX_STORAGE_KEY`, `outboxItemKey`, `isOutboxStorageKey`.
- `packages/storage/blocked-merge.ts` — pure logic and types: `BlockedAccount`, `BlockedStats`, `accountKeyFor`, `mergeBlockedAccount`, `foldAccountSnapshot`, `summarizeAccounts`. Shared with the Convex backend. Not changed by this plan.
- `packages/storage/chrome-storage.ts` — storage wrappers. After plan 003 it exports `storageGetByPrefix(prefix, exactKeys?)`.
- App callers of the store, found with `rg -n "blockedStore\." entrypoints packages -g '!**/tests/**'`:
  - `entrypoints/content/actions.ts:159,166` — `record`
  - `entrypoints/popup/main.ts:443,472` — `stats`, `onChange`
  - `entrypoints/options/panes/blocked-log.ts:106-107` — `list`, `pending`
  - `packages/sync/cloud-session.ts:108-115` — `pending`, `markSynced`
  - `packages/sync/sync-engine.ts:86` — passes the store as the collection port (`pending`, `markSynced`, `mergeRemote`)
- `has`, `get`, and `hasActiveHandle` have no caller outside tests.
- Files that seed or read the legacy key `"blockedAccounts"` directly: `packages/storage/tests/blocked-store.test.ts`, `packages/sync/tests/cloud-session.test.ts:373,388`, `packages/sync/tests/sync-engine.test.ts:193`, `test/popup/popup.test.ts:145,168,202`, `test/options/blocked-log.test.ts:142,274`, `tools/design/data.ts:46,52`.
- `wxt.config.ts:52` — `permissions: ["storage", "alarms"],`

The interface, `packages/storage/blocked-store.ts:92-108` today:

```ts
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
```

The write path, `packages/storage/blocked-store.ts:180-194` and `:216-241` today:

```ts
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
```

```ts
    record(input) {
      return enqueueMutation(async () => {
        const map = await loadMap();
        const existingKey = findExistingKey(map, input);
        const existing = existingKey ? map[existingKey] : undefined;
        const merged = mergeBlockedAccount(existing, input, Date.now(), genId);
        const storeKey = existingKey ?? merged.key;
        map[storeKey] = merged;

        const lastAction = merged.actions[merged.actions.length - 1];
        const write: Record<string, unknown> = { [ACCOUNTS_KEY]: map };
        if (lastAction) {
          const item: OutboxItem = {
            accountKey: storeKey,
            ...(merged.xUserId ? { xUserId: merged.xUserId } : {}),
            handle: merged.handle,
            idUnknown: merged.idUnknown,
            action: lastAction,
          };
          write[outboxItemKey(lastAction.actionId)] = item;
        }

        await storageSet(write);
        return merged;
      });
    },
```

The read paths, `packages/storage/blocked-store.ts:243-251` and `:333-349` today:

```ts
    async list() {
      const map = await loadMap();
      return Object.values(map);
    },

    async stats() {
      const map = await loadMap();
      return summarizeAccounts(Object.values(map));
    },
```

```ts
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
```

`packages/storage/blocked-merge.ts:269-278` today:

```ts
export function summarizeAccounts(accounts: BlockedAccount[]): BlockedStats {
  let blocked = 0;
  let muted = 0;
  for (const account of accounts) {
    if (account.status !== "active") continue;
    if (account.blockCount > 0) blocked++;
    if (account.muteCount > 0) muted++;
  }
  return { accounts: accounts.length, blocked, muted };
}
```

### Expected drift

- After plan 002, `mergeRemote` builds two index maps and sets `changed` only on a real difference. Keep both behaviors.
- After plan 003, `pending` and `markSynced` call `storageGetByPrefix` instead of `storageGetAll`. Keep that.

### Existing design constraints to keep

The long comment at `packages/storage/blocked-store.ts:147-167` explains that mutations are serialized only within one JS context, that different contexts can overwrite each other, and that this is self-healing because an account write and its outbox entry go out in one `storage.set`. This plan keeps that property: the account key, its outbox key, and the counters key go out in one `storage.set`. Keep that comment unless the code it describes is deleted.

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. A comment may leave only together with the code it describes.
- Do not edit any Markdown file except the status row in `plans/README.md`.
- Do not add lint suppressions or `as` type assertions. Use type predicates.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- `packages/storage` must not import from `packages/sync`. Code outside a package imports only the package's root files.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Target storage layout

All keys are in `chrome.storage.local`.

| Key | Value | Written by |
|---|---|---|
| `blockedAccount:<storeKey>` | one `BlockedAccount` | `record`, `mergeRemote`, migration |
| `blockedXid:<xUserId>` | the `storeKey` of the account that has this id, written only when `storeKey !== xUserId` | `record`, `mergeRemote`, migration |
| `blockedStats` | `BlockedStats` (`{ accounts, blocked, muted }`) | `record`, `mergeRemote`, `list`, `stats`, migration |
| `blockedOutbox:<actionId>` | unchanged | unchanged |
| `blockedAccounts` | legacy map; read once by migration, then removed | migration only |

`storeKey` is the account's existing `key` field: the numeric id, or `@handle` in lower case.

Why the `blockedXid:` alias exists: a record first stored under `@handle` keeps that key after its numeric id is learned. Today `findExistingKey` finds it by scanning every account for a matching `xUserId`. The alias replaces that scan with one key read.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Boundaries | `bun run lint:boundaries` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test packages/storage` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |
| Build | `bun run build` | exit 0 |

## Scope

**In scope**:

- `packages/storage/blocked-store.ts`
- `packages/storage/tests/blocked-store.test.ts`
- `packages/sync/tests/cloud-session.test.ts` and `packages/sync/tests/sync-engine.test.ts` (only assertions that read `storageFake.data["blockedAccounts"]`)
- `test/popup/popup.test.ts` (only the fake change event at line 202 and assertions that depend on it)
- `test/options/blocked-log.test.ts` (only if an assertion reads the legacy key back)
- `wxt.config.ts` (only the `permissions` array)

**Out of scope** (do NOT touch):

- `packages/storage/blocked-merge.ts` — shared with Convex.
- `convex/**` and `packages/sync/*.ts` source files — the collection port is unchanged.
- `entrypoints/popup/main.ts`, `entrypoints/options/panes/blocked-log.ts`, `entrypoints/content/actions.ts` — they call `stats`, `onChange`, `list`, `pending`, `record`, whose signatures do not change.
- `tools/design/data.ts` — it seeds the legacy key on purpose now; migration converts it.
- `packages/storage/whitelist-store.ts`.

## Git workflow

- Branch: `advisor/005-one-storage-key-per-account`
- One commit per step. Conventional style, for example `perf(storage): store one key per blocked account`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the three unused methods

Confirm with `rg -n "\.has\(|\.get\(|hasActiveHandle" entrypoints packages -g '!**/tests/**' -g '!packages/storage/blocked-store.ts'` that no app code calls `blockedStore.has`, `blockedStore.get`, or `hasActiveHandle` (matches on `Map`/`Set` `.has`/`.get` are unrelated). Delete those three methods from the `BlockedStore` interface and from `createBlockedStore`, with the doc comment attached to `hasActiveHandle`. Delete the tests that exercise only those methods.

**Verify**: `bun run typecheck` → exit 0. `bun test packages/storage/tests/blocked-store.test.ts` → all pass.

### Step 2: Add key helpers and the migration

In `packages/storage/blocked-store.ts`:

1. Add constants `ACCOUNT_ITEM_PREFIX = "blockedAccount:"`, `XID_ALIAS_PREFIX = "blockedXid:"`, `STATS_KEY = "blockedStats"`, and helper functions `accountItemKey(storeKey)` and `xidAliasKey(xUserId)`. Keep `ACCOUNTS_KEY = "blockedAccounts"` as the legacy key name.
2. Add a type predicate `isBlockedStats(value: unknown): value is BlockedStats` that checks the three numeric fields.
3. Inside `createBlockedStore`, add `ensureMigrated(): Promise<void>` that runs at most once per store instance (keep the promise in a closure variable; if it rejects, clear the variable so the next call retries). It must:
   - read the legacy key with the existing strict `readKey(ACCOUNTS_KEY)`;
   - if the value is not an object, return;
   - build one write object with `accountItemKey(key)` for every entry, `xidAliasKey(account.xUserId)` for every account whose `xUserId` exists and differs from its map key, and `STATS_KEY` set to `summarizeAccounts(Object.values(map))`;
   - before writing, read the existing per-account keys with `storageGetByPrefix(ACCOUNT_ITEM_PREFIX)` and drop from the write every account key that already exists there, then recompute the stats over the union. A second context may have migrated first, and its newer records must win;
   - `await storageSet(write)`, then `await storageRemove(ACCOUNTS_KEY)`.
4. Call `await ensureMigrated()` at the start of `record`, `list`, `stats`, and `mergeRemote` (inside the `enqueueMutation` callback for the two mutations).

Tests to add in `packages/storage/tests/blocked-store.test.ts`:

- A legacy map with three accounts (one of them handle-keyed with a known `xUserId`) migrates to three account keys, one alias key, a correct `blockedStats`, and no `blockedAccounts` key.
- Migration runs once: a second `list()` performs no legacy read (count `chrome.storage.local.get` calls that ask for `"blockedAccounts"`).
- With no legacy key, nothing is written.
- A per-account key that already exists is not overwritten by the legacy copy.
- A failed legacy read rejects the calling operation and the next call retries the migration.

**Verify**: `bun test packages/storage/tests/blocked-store.test.ts` → the new migration tests pass. Other tests may fail until step 3.

### Step 3: Rewrite `record`

`record(input)` inside `enqueueMutation`, after `ensureMigrated()`:

1. Compute `directKey = accountKeyFor(input)` and, when `input.xUserId` is set, `handleKey = accountKeyFor({ handle: input.handle })`.
2. One strict read of these keys: `accountItemKey(directKey)`, `STATS_KEY`, and when `input.xUserId` is set also `accountItemKey(handleKey)` and `xidAliasKey(input.xUserId)`. Add a small strict multi-key reader next to `readKey` that rejects when the callback receives `undefined`.
3. Resolve the existing record in today's order: direct key, then handle key, then the alias. If only the alias matched, read `accountItemKey(aliasTarget)` with one more strict read.
4. `merged = mergeBlockedAccount(existing, input, Date.now(), genId)`; `storeKey = existingKey ?? merged.key`.
5. Compute the new stats from the stored stats: subtract the old record's contribution and add the new one. Compute a contribution with `summarizeAccounts([account])`. If the stored stats value fails `isBlockedStats`, omit `STATS_KEY` from this write (the next `stats()` or `list()` call rebuilds it).
6. One `storageSet` with: `accountItemKey(storeKey)`, the outbox key exactly as today, `STATS_KEY` (when computed), and `xidAliasKey(merged.xUserId)` when `merged.xUserId` exists and differs from `storeKey`.

Delete `findExistingKey` and `loadMap` once nothing uses them.

Tests to add or adapt:

- A new account writes exactly three keys: the account, the outbox item, the stats. Assert with the keys of the object passed to `chrome.storage.local.set`.
- With 1,000 seeded accounts, `record` never passes `null` to `chrome.storage.local.get` and never reads a key outside the four named in item 2.
- Handle-keyed record, then the same account recorded with a numeric id: one account results, stored under the `@handle` key, and `blockedXid:<id>` points at it.
- After that, a record with the same id but a different handle finds the account through the alias.
- Stats change correctly for: first block, second block of the same account (no change in `accounts` or `blocked`), a mute of a blocked account (`muted` +1).

**Verify**: `bun test packages/storage/tests/blocked-store.test.ts` → all `record` tests pass.

### Step 4: Rewrite `list`, `stats`, `onChange`

- `list()`: `storageGetByPrefix(ACCOUNT_ITEM_PREFIX)`, return the values that are objects. After loading, compute `summarizeAccounts(values)`; if it differs from the stored `blockedStats`, write the corrected stats. This is the repair path for counter drift.
- `stats()`: strict-read `STATS_KEY`. If it passes `isBlockedStats`, return it. Otherwise compute it through the same path as `list()`, store it, and return it.
- `onChange(callback)`: keep the guard. The listener reacts to `changes[STATS_KEY]` in area `"local"` and calls `callback(change.newValue)` when it passes `isBlockedStats`. It ignores other keys. Delete `isAccountMap` if unused.

Tests:

- `stats()` returns the stored counters without reading any account key.
- `stats()` with no stored counters rebuilds them from the accounts and stores them.
- `list()` repairs wrong stored counters.
- `onChange` fires for a `blockedStats` change in `"local"`, ignores area `"sync"`, ignores a malformed value, and ignores an account-key change. Adapt test `BS-25`.

**Verify**: `bun test packages/storage/tests/blocked-store.test.ts` → all pass.

### Step 5: Rewrite `mergeRemote`

After `ensureMigrated()`:

1. Load all accounts with `storageGetByPrefix(ACCOUNT_ITEM_PREFIX)` and build an in-memory map `storeKey → account` (strip the prefix).
2. Run the same matching and folding as today (with plan 002's indexes), but collect changed and new accounts in a `Map<storeKey, BlockedAccount>` instead of one `changed` flag.
3. If that map is empty, write nothing.
4. Otherwise one `storageSet` with: `accountItemKey(k)` for each changed account, `xidAliasKey` for each changed account whose `xUserId` exists and differs from its store key, and `STATS_KEY` recomputed over the full in-memory map.

Tests:

- A pull that changes one of 100 accounts writes that one account key and the stats key, and no other account key.
- A pull with no changes makes no `set` call.
- The existing `mergeRemote` behavior tests pass after their assertions read per-account keys.

**Verify**: `bun test packages/storage` → all pass.

### Step 6: Fix the dependent tests and add the permission

1. In `packages/sync/tests/cloud-session.test.ts`, `packages/sync/tests/sync-engine.test.ts`, and `test/options/blocked-log.test.ts`: tests may keep seeding `storageFake.data["blockedAccounts"]` (migration converts it). Change only assertions that read that key back, to read `storageFake.data["blockedAccount:<key>"]`.
2. In `test/popup/popup.test.ts:202`, the fake change event must carry `{ blockedStats: { newValue: { accounts, blocked, muted } } }`.
3. In `wxt.config.ts`, change the permissions line to `permissions: ["storage", "unlimitedStorage", "alarms"],`.

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run lint:boundaries` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met
- `bun run build` → exit 0, and `rg -c "unlimitedStorage" .output/chrome-mv3/manifest.json` prints `1`

## Test plan

- New and adapted tests are listed per step. All live in `packages/storage/tests/blocked-store.test.ts` except the adaptations in step 6.
- Structural pattern: the existing `BS-*` tests. They build accounts with `mkAccount` and remote rows with `mkSnapshot` (top of the file), and inspect `storageFake.data`.
- To count or inspect storage calls, wrap `chrome.storage.local.get` / `.set` inside the test and restore them afterwards.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run lint:boundaries`, `bun run format:check` exit 0
- [ ] `bun test` exits 0, coverage threshold met
- [ ] `bun run build` exits 0 and the built manifest contains `unlimitedStorage`
- [ ] `rg -n "\[ACCOUNTS_KEY\]: map" packages/storage/blocked-store.ts` returns no matches
- [ ] `rg -n "hasActiveHandle" entrypoints packages` returns no matches
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The quoted code differs from the live file in a way not listed under "Expected drift".
- Plan 003 has not landed (`rg -n "storageGetByPrefix" packages/storage/chrome-storage.ts` returns nothing).
- Any app code calls `has`, `get`, or `hasActiveHandle` on the blocked store.
- A test outside the in-scope list fails and the fix needs a source change in `entrypoints/` or `packages/sync/*.ts`.
- You find a path where an account write and its outbox entry would go out in two separate `storage.set` calls.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Counter drift: two tabs that record at the same moment can each read the same `blockedStats` and both write, losing one increment. `list()` and `mergeRemote` rewrite the exact counters, so the options page and every cloud sync repair it. Do not treat the counters as an audit figure.
- The owner should load the built extension over a profile that has existing data and confirm the popup counts and the Blocked log match the numbers from before the update. This plan cannot verify that step in an automated test against real Chrome.
- `list()` still loads every account. The options Blocked log is the only caller, and it needs them all.
- Each account still carries its full `actions[]` history. Capping that history is a possible follow-up; it changes what the Blocked log can show, so it needs an owner decision.
- Reviewers: read `record` and confirm it never calls `get(null)` and writes at most four keys.
