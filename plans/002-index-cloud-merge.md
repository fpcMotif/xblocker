# Plan 002: A cloud pull merges in linear time and writes only when something changed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- packages/storage/blocked-store.ts packages/storage/tests/blocked-store.test.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. The excerpts under "Current
> state" are the authority. If the live code does not match them, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

`mergeRemote` scans the whole local blocked list once or twice for every remote row, and it rewrites the whole list after every cloud pull even when the pull changed nothing. This plan builds two lookup maps once per merge and skips the storage write when no account changed. Which local record a remote row matches, and the merged values, stay unchanged.

## Why this matters

Every cloud sync pulls all remote rows and calls `mergeRemote`. With R remote rows and N local accounts the current loop costs R × N comparisons and allocates `Object.entries(map)` inside the loop. At 30,000 by 30,000 that can freeze the popup, the options page, or the background worker. The unconditional write also sends the full list to every listening context on each sync. After this plan the merge costs R + N, and a pull with no changes writes nothing.

## Current state

- `packages/storage/blocked-store.ts` — the local blocked-accounts store. `mergeRemote` is at lines 273-331.
- `packages/storage/blocked-merge.ts` — pure merge logic. `foldAccountSnapshot(local, row)` at lines 249-266 returns a new `BlockedAccount`. `accountKeyFor` at lines 77-79.
- `packages/storage/tests/blocked-store.test.ts` — tests named `BS-*`.

`packages/storage/blocked-store.ts:273-331` today:

```ts
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
            const needle = normalizeHandleForLookup(row.handle);
            for (const [candidate, account] of Object.entries(map)) {
              if (account.idUnknown && normalizeHandleForLookup(account.handle) === needle) {
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

        if (changed) await storageSet({ [ACCOUNTS_KEY]: map });
      });
    },
```

`packages/storage/blocked-merge.ts:249-266` today (the fields a fold can change):

```ts
export function foldAccountSnapshot(
  local: BlockedAccount,
  row: RemoteAccountSnapshot,
): BlockedAccount {
  const remoteNewer = row.lastActionAt > local.lastActionAt;
  const learnedId = local.xUserId ?? (row.idUnknown ? undefined : row.xUserId);
  return {
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
}
```

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. A comment may leave only together with the code it describes.
- Do not add lint suppressions.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test packages/storage/tests/blocked-store.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `packages/storage/blocked-store.ts` (only `mergeRemote` and new private helpers next to it)
- `packages/storage/tests/blocked-store.test.ts`

**Out of scope** (do NOT touch):

- `packages/storage/blocked-merge.ts` — the fold arithmetic is shared with the Convex backend. Do not change it.
- `record()` and the storage layout — plan 005 owns those.
- `packages/storage/whitelist-store.ts`.
- Anything under `packages/sync/`.

## Git workflow

- Branch: `advisor/002-index-cloud-merge`
- One commit, conventional style, for example `perf(storage): index the cloud merge and skip no-op writes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the failing tests first

Add to `packages/storage/tests/blocked-store.test.ts`:

- **No-op pull writes nothing**: seed one local account, call `mergeRemote` with a remote row whose values equal the local account's rollup fields, and assert `chrome.storage.local.set` was not called. Count calls by wrapping `chrome.storage.local.set` for the test and restoring it afterwards.
- **Changed pull writes once**: same setup with a higher remote `blockCount`. Assert exactly one `set` call and the merged value.
- **First match wins, by id**: seed two local accounts under different keys that share the same `xUserId`, in a known insertion order. Merge a row with that `xUserId` whose direct key is absent. Assert the first inserted account is the one folded.
- **First match wins, by handle**: seed two `idUnknown: true` accounts whose handles differ only by case. Merge a row with a known id and that handle. Assert the first inserted account is the one folded.
- **A row inserted earlier in the same pull is found by a later row**: merge two remote rows for the same new account in one call. Assert one local account results.

**Verify**: `bun test packages/storage/tests/blocked-store.test.ts` → the no-op test fails, because the current code always writes. The others may already pass. That is expected: they pin behavior that step 2 must keep.

### Step 2: Build the indexes once and track real changes

Inside the `enqueueMutation` callback of `mergeRemote`:

1. After `loadMap()`, build two `Map<string, string>` indexes with one pass over `Object.entries(map)`:
   - `keyByXUserId`: `account.xUserId` → map key, only for accounts that have an `xUserId`.
   - `keyByUnknownHandle`: `normalizeHandleForLookup(account.handle)` → map key, only for accounts with `idUnknown === true`.
   Insert with "first wins": do not overwrite an existing entry. This keeps the current match order.
2. Replace the two inner `for … of Object.entries(map)` loops with lookups in those indexes. Keep the three-stage order: direct key, then `keyByXUserId.get(row.xUserId)`, then (only when `!row.idUnknown`) `keyByUnknownHandle.get(normalizeHandleForLookup(row.handle))`.
3. When a new account is inserted into `map`, add it to both indexes under the same "first wins" rule, so a later row in the same pull finds it.
4. When an existing account is folded, compare the result with the previous record on these fields: `handle`, `idUnknown`, `xUserId`, `firstActionAt`, `lastActionAt`, `blockCount`, `muteCount`, `status`. Assign into `map` and set `changed = true` only when at least one differs. Put the comparison in a small private function in `blocked-store.ts`, for example `sameRollup(a, b)`.
5. When a fold changes `xUserId` or `idUnknown`, update the indexes to match: add the learned id to `keyByXUserId`, and remove the handle from `keyByUnknownHandle` when `idUnknown` became false.
6. Keep `if (changed) await storageSet({ [ACCOUNTS_KEY]: map });` as the single write.

Keep the two existing comments inside the loop attached to the code they describe.

**Verify**: `bun test packages/storage/tests/blocked-store.test.ts` → all pass.

### Step 3: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- The five tests in step 1, in `packages/storage/tests/blocked-store.test.ts`.
- Structural pattern: the existing `mergeRemote` tests in that file. Find them with `rg -n "mergeRemote" packages/storage/tests/blocked-store.test.ts`.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the five new tests present and passing
- [ ] `rg -n "Object.entries\(map\)" packages/storage/blocked-store.ts` shows no match inside the `for (const row of remote)` loop
- [ ] `git status --short` lists only the two in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `mergeRemote` does not match the excerpt.
- An existing `BS-*` test fails after step 2 and the cause is a change in which local record a row matches.
- The storage layout has already changed to one key per account (plan 005 landed first). In that case this plan is obsolete; mark it REJECTED in `plans/README.md` with that reason.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Plan 005 rewrites the storage layout. It must keep these indexes and the "write only what changed" rule.
- `packages/sync/sync-engine.ts:203-204` still pulls every remote row on every sync. A delta pull (an `updatedAt` index in Convex) is the next step for sync cost. It was left out because deletions need a tombstone design first.
- Reviewers: check that a pull with identical data produces zero `chrome.storage.local.set` calls.
