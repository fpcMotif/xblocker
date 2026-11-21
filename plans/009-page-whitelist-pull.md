# Plan 009: The whitelist cloud pull is paged

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- convex/whitelist.ts packages/sync/lib/convex-sync.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. Plan 010 may have changed the
> two push functions in `convex-sync.ts`; that is expected. Any mismatch in
> the code quoted below is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

The Convex query that returns the whitelist collects every row into one array, and Convex rejects a returned array above 8,192 items. This plan adds a paged query beside it and makes the extension walk the pages, falling back to the old query on a deployment that does not have the new one yet. The row shape, the old query, and the merge logic stay unchanged.

## Why this matters

Whitelist rows are never deleted in the cloud: a removal is stored as a row with status `removed`. The table only grows. Once it passes 8,192 rows, `listWhitelist` throws on every call. The sync engine runs the collections in order and stops at the first error, so from that moment every sync reports failure. The blocked list had the same problem and was fixed in commit `c7bf141` with a paged query; this plan applies the same fix to the whitelist.

## Current state

- `convex/whitelist.ts` — Convex functions for the whitelist (78 lines): `upsertWhitelistEntries` and `listWhitelist`.
- `convex/blocked.ts:183-211` — `listBlockedPage`, the exemplar paged query.
- `convex/schema.ts:47-55` — table `whitelistEntries` with indexes `by_owner_handle` and `by_owner`.
- `packages/sync/lib/convex-sync.ts` — the extension's Convex client wrapper. It is excluded from coverage in `bunfig.toml` because it is thin live I/O.

`convex/whitelist.ts:60-78` today:

```ts
// All of the owner's whitelist entries in BOTH statuses, shaped for the local store's
// mergeRemote — the client, not the query, decides what "active" means on merge (a
// "removed" row is how a deletion propagates).
export const listWhitelist = query({
  args: {},
  returns: v.array(remoteWhitelistEntryValidator),
  handler: async (ctx) => {
    const entries = await ctx.db
      .query("whitelistEntries")
      .withIndex("by_owner", (q) => q.eq("owner", OWNER))
      .collect();

    return entries.map((entry) => ({
      handle: entry.handle,
      status: entry.status,
      updatedAt: entry.updatedAt,
    }));
  },
});
```

The exemplar, `convex/blocked.ts:183-196` today (its imports are `import { paginationOptsValidator } from "convex/server";` and `import { v } from "convex/values";`):

```ts
export const listBlockedPage = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(remoteAccountValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("blockedAccounts")
      .withIndex("by_owner", (q) => q.eq("owner", OWNER))
      .paginate(args.paginationOpts);
```

`packages/sync/lib/convex-sync.ts:46-67` today:

```ts
type BlockedPage = { page: RemoteAccount[]; isDone: boolean; continueCursor: string };
const listBlockedPageRef = makeFunctionReference<
  "query",
  { paginationOpts: { numItems: number; cursor: string | null } },
  BlockedPage
>("blocked:listBlockedPage");
...
/** Accounts per pull page. Convex caps a returned array at 8,192 items. */
const PULL_PAGE_SIZE = 1000;
...
const listWhitelistRef = makeFunctionReference<
  "query",
  Record<string, never>,
  RemoteWhitelistEntry[]
>("whitelist:listWhitelist");
```

`packages/sync/lib/convex-sync.ts:87-91`, `:122-136`, and `:178-181` today:

```ts
// A deployment that predates the batched mutation rejects it with a "could not find
// public function" error; that is the only error worth degrading on.
function isMissingFunctionError(error: unknown): boolean {
  return error instanceof Error && /could not find.*function/i.test(error.message);
}
```

```ts
export async function pullBlocked(): Promise<RemoteAccount[]> {
  const accounts: RemoteAccount[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: BlockedPage = await client().query(listBlockedPageRef, {
      paginationOpts: { numItems: PULL_PAGE_SIZE, cursor },
    });
    accounts.push(...result.page);
    if (result.isDone) {
      return accounts;
    }
    cursor = result.continueCursor;
  }
}
```

```ts
/** Pull all whitelist entries (both statuses) from Convex. */
export async function pullWhitelist(): Promise<RemoteWhitelistEntry[]> {
  return client().query(listWhitelistRef, {});
}
```

Why a fallback is needed: the extension and the Convex deployment are updated separately. The owner deploys Convex by hand with `bun run convex:deploy`. An updated extension may talk to a deployment that has only `listWhitelist`.

Repo conventions that bind this work:

- Keep every existing comment exactly as written. A new Convex function may carry a short comment in the style of the file's other functions, because every function in `convex/*.ts` has one. If the `doc-lock` hook rejects it, omit the comment and report that.
- Do not edit `convex/_generated/**`. Do not run `convex dev`, `convex deploy`, or `convex codegen`: they need the owner's deployment.
- Do not add lint suppressions or `as` type assertions.
- The Convex functions have no authentication by documented design (`convex/README.md`, "No sign-in (single-owner)"). Do not add any.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (extension) | `bun run typecheck` | exit 0 |
| Typecheck (Convex) | `bunx tsc --noEmit -p convex/tsconfig.json` | exit 0, no output |
| Lint | `bun run lint` | exit 0 |
| Boundaries | `bun run lint:boundaries` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `convex/whitelist.ts`
- `packages/sync/lib/convex-sync.ts` (only the whitelist pull and its function reference)

**Out of scope** (do NOT touch):

- `convex/schema.ts` — the `by_owner` index already exists.
- `convex/blocked.ts`.
- `convex/_generated/**`.
- `packages/sync/sync-engine.ts` and `packages/storage/**`.
- The existing `listWhitelist` query: keep it, unchanged, for extensions that have not updated.

## Git workflow

- Branch: `advisor/009-page-whitelist-pull`
- One commit. Conventional style, for example `fix(sync): page the whitelist cloud pull`.
- Do NOT push, open a PR, or deploy Convex unless the operator instructed it.

## Steps

### Step 1: Add the paged query

In `convex/whitelist.ts`:

1. Add `import { paginationOptsValidator } from "convex/server";`.
2. After `listWhitelist`, add `listWhitelistPage`, shaped exactly like `listBlockedPage`:
   - `args: { paginationOpts: paginationOptsValidator }`
   - `returns: v.object({ page: v.array(remoteWhitelistEntryValidator), isDone: v.boolean(), continueCursor: v.string() })`
   - handler: query `whitelistEntries` with index `by_owner` and `q.eq("owner", OWNER)`, call `.paginate(args.paginationOpts)`, and map each row of `result.page` to `{ handle, status, updatedAt }`, returning `{ page, isDone: result.isDone, continueCursor: result.continueCursor }`.

The root `tsconfig.json` excludes `convex/`, so `bun run typecheck` does not check this file. Use the Convex command.

**Verify**: `bunx tsc --noEmit -p convex/tsconfig.json` → exit 0, no output. `bun run lint` → exit 0. `rg -n "export const listWhitelistPage" convex/whitelist.ts` → one match.

### Step 2: Walk the pages from the extension, with a fallback

In `packages/sync/lib/convex-sync.ts`:

1. Add a `WhitelistPage` type and a `listWhitelistPageRef` function reference for `"whitelist:listWhitelistPage"`, mirroring `BlockedPage` and `listBlockedPageRef`.
2. Rewrite `pullWhitelist` to loop like `pullBlocked`, using `PULL_PAGE_SIZE`.
3. Wrap only the first page request in a `try`/`catch`. If the error satisfies `isMissingFunctionError`, return `client().query(listWhitelistRef, {})`. Rethrow any other error. Later pages are not wrapped.
4. Keep `listWhitelistRef` and the existing doc comment above `pullWhitelist`.

**Verify**: `bun run typecheck` → exit 0. `bun run lint` → exit 0.

### Step 3: Run the full gates

**Verify**:

- `bun run lint:boundaries` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- No new unit test. `packages/sync/lib/convex-sync.ts` is excluded from coverage on purpose (`bunfig.toml`, `coveragePathIgnorePatterns`), and Convex handlers do not run in the unit suite.
- The automated checks are the typecheck, lint, and the unchanged full test run.
- Manual check for the owner, to be listed in your report: after `bun run convex:deploy`, open the options page, press "Sync now", and confirm the whitelist count is unchanged and no error shows.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run lint:boundaries`, `bun run format:check` exit 0
- [ ] `bunx tsc --noEmit -p convex/tsconfig.json` exits 0
- [ ] `bun test` exits 0
- [ ] `rg -n "listWhitelistPage" convex/whitelist.ts packages/sync/lib/convex-sync.ts` shows the query and its reference
- [ ] `rg -n "export const listWhitelist = query" convex/whitelist.ts` still matches
- [ ] `git status --short` lists only the two in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated
- [ ] Your report tells the owner to run `bun run convex:deploy`

## STOP conditions

Stop and report back if:

- The quoted code does not match the live files.
- `bunx tsc --noEmit -p convex/tsconfig.json` fails before you change anything. It passed when this plan was written.
- The change seems to need a schema change or an edit under `convex/_generated/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Order of release does not matter: an old extension keeps calling `listWhitelist`; a new extension falls back to it on an old deployment. Once both sides are updated and the table is above 8,192 rows, only the paged path works.
- `listWhitelist` can be deleted after every installed copy of the extension has the paged client.
- `upsertWhitelistEntries` and `recordActions` accept arrays of any length from the client. The client sends 50 per call. A server-side length check is a possible follow-up.
- Reviewers: confirm the fallback wraps only the first request.
