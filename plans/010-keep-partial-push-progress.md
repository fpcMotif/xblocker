# Plan 010: A failed push keeps the batches the cloud already accepted

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- packages/sync/sync-engine.ts packages/sync/lib/convex-sync.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. Plan 004 may have added a
> `staleMs` parameter to three functions in `sync-engine.ts`, and plan 009 may
> have changed `pullWhitelist`; both are expected. Any mismatch in the code
> quoted below is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

The outbox is pushed to the cloud in batches of 50, but the local outbox is cleared only after every batch succeeds. If batch 3 of 10 fails, batches 1 and 2 stay queued and are sent again on every retry. This plan clears each batch from the outbox as soon as the cloud accepts it. Batch size, ordering, the legacy per-item fallback, and what happens to the failing batch stay unchanged.

## Why this matters

A push that fails part-way wastes the work already done, and it repeats that waste on every retry. If one item can never be accepted, every batch before it is re-sent for ever. The cloud mutations are idempotent, so no data is wrong today; the cost is repeated network and database work. After this plan a retry starts at the first batch that was not accepted.

## Current state

- `packages/sync/sync-engine.ts` — the sync engine. `CloudAdapter` type at lines 37-42, `runCloudSync` at lines 181-209.
- `packages/sync/lib/convex-sync.ts` — the Convex adapter. `pushOutbox` at lines 100-120, `pushWhitelistOutbox` at lines 169-176. Excluded from coverage in `bunfig.toml`.
- `packages/sync/tests/sync-engine.test.ts` — engine tests with fake adapters.

`packages/sync/sync-engine.ts:37-42` today:

```ts
export type CloudAdapter<Item = OutboxItem, Remote = RemoteAccount> = {
  isConfigured(): boolean;
  push(items: Item[]): Promise<string[]>;
  pull(): Promise<Remote[]>;
  clear?(): Promise<void>;
};
```

`packages/sync/sync-engine.ts:195-204` today:

```ts
  const pending = await collection.store.pending();
  // Captured before the push: a store may return its live outbox array, which
  // markSynced then drains — reading .length after that would under-report.
  const pendingCount = pending.length;
  if (pendingCount > 0) {
    const synced = await adapter.push(pending);
    await collection.store.markSynced(synced);
  }
  const remote = await adapter.pull();
  await collection.store.mergeRemote(remote);
```

`packages/sync/lib/convex-sync.ts:100-120` today:

```ts
export async function pushOutbox(items: OutboxItem[]): Promise<string[]> {
  const synced: string[] = [];
  let batchUnsupported = false;
  for (const batch of outboxToRecordBatches(items, PUSH_BATCH_SIZE)) {
    if (!batchUnsupported) {
      try {
        await client().mutation(recordActionsRef, { actions: batch.args });
        synced.push(...batch.actionIds);
        continue;
      } catch (error) {
        if (!isMissingFunctionError(error)) throw error;
        batchUnsupported = true;
      }
    }
    for (const item of batch.items) {
      await client().mutation(recordActionRef, outboxItemToRecordArgs(item));
      synced.push(item.action.actionId);
    }
  }
  return synced;
}
```

`packages/sync/lib/convex-sync.ts:169-176` today:

```ts
export async function pushWhitelistOutbox(items: WhitelistOutboxItem[]): Promise<string[]> {
  const synced: string[] = [];
  for (const batch of whitelistOutboxToBatches(items, PUSH_BATCH_SIZE)) {
    await client().mutation(upsertWhitelistEntriesRef, { entries: batch.args });
    synced.push(...batch.actionIds);
  }
  return synced;
}
```

`markSynced` removes outbox keys by action id. Calling it twice with the same ids is harmless: the second call removes nothing.

Design decision in `docs/adr/0003-sync-policy-and-cloud-adapter.md`: the engine talks to the cloud only through the `CloudAdapter` seam, in the collection's own vocabulary (outbox items in, accepted action ids out). This plan keeps that seam and adds one optional callback parameter to `push`.

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work.
- Do not add lint suppressions or `as` type assertions.
- `bunfig.toml` sets `coverageThreshold = 1.0` for everything except `packages/sync/lib/convex-sync.ts`. Engine changes need tests.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test packages/sync/tests/sync-engine.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `packages/sync/sync-engine.ts` (the `CloudAdapter` type and the push call in `runCloudSync`)
- `packages/sync/lib/convex-sync.ts` (`pushOutbox`, `pushWhitelistOutbox`)
- `packages/sync/tests/sync-engine.test.ts`

**Out of scope** (do NOT touch):

- `packages/storage/**` — `markSynced` is used as it is.
- `packages/sync/cloud-wire.ts`, `packages/sync/whitelist-wire.ts` — batching stays as it is.
- `convex/**`.
- `packages/sync/cloud-session.ts`.

## Git workflow

- Branch: `advisor/010-keep-partial-push-progress`
- One commit. Conventional style, for example `fix(sync): mark each accepted push batch synced as it lands`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the failing engine test

In `packages/sync/tests/sync-engine.test.ts`, add a test using a fake adapter (follow the fake adapters already in the file):

- The outbox holds four queued actions.
- The fake `push(items, onAccepted)` calls `await onAccepted?.([id1, id2])` and then throws.
- `runCloudSync` rejects with that error.
- Afterwards `collection.store.pending()` returns only the two actions that were not accepted.

Add a second test: a fake adapter whose `push` ignores the second parameter and returns all ids still leaves the outbox empty (today's behavior).

**Verify**: `bun test packages/sync/tests/sync-engine.test.ts` → the first new test fails, the second passes.

### Step 2: Extend the seam and the engine

In `packages/sync/sync-engine.ts`:

1. Change the `push` member of `CloudAdapter` to:

```ts
  push(items: Item[], onAccepted?: (actionIds: string[]) => Promise<void>): Promise<string[]>;
```

2. In `runCloudSync`, change the push call to:

```ts
    const synced = await adapter.push(pending, (actionIds) =>
      collection.store.markSynced(actionIds),
    );
    await collection.store.markSynced(synced);
```

Keep the final `markSynced(synced)` call. It covers adapters that ignore the callback, and it is a no-op for ids already removed.

**Verify**: `bun test packages/sync/tests/sync-engine.test.ts` → all pass. `bun run typecheck` → exit 0.

### Step 3: Report each accepted batch from the Convex adapter

In `packages/sync/lib/convex-sync.ts`:

1. `pushOutbox(items, onAccepted?)`: after a successful `recordActionsRef` mutation, `await onAccepted?.(batch.actionIds)` before `synced.push(...)`. In the per-item fallback loop, after each successful `recordActionRef` mutation, `await onAccepted?.([item.action.actionId])`.
2. `pushWhitelistOutbox(items, onAccepted?)`: after each successful mutation, `await onAccepted?.(batch.actionIds)`.
3. The parameter type is `(actionIds: string[]) => Promise<void>`, optional. Return values are unchanged.

**Verify**: `bun run typecheck` → exit 0 (the `satisfies CloudAdapter` clauses at the bottom of the file must still hold).

### Step 4: Run the full gates

**Verify**:

- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- Two engine tests (step 1) in `packages/sync/tests/sync-engine.test.ts`.
- Structural pattern: the existing `runCloudSync` tests in that file that build a fake adapter and seed the outbox through the store.
- The adapter change in `convex-sync.ts` has no unit test, by the file's documented coverage exemption. The typecheck's `satisfies CloudAdapter` is its check.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the two new tests present and passing
- [ ] `rg -n "onAccepted" packages/sync/sync-engine.ts packages/sync/lib/convex-sync.ts` shows the type, both adapter functions, and no other file
- [ ] `git status --short` lists only the three in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The quoted code does not match the live files beyond the expected drift named at the top.
- A test fake elsewhere in the repository implements `push` with a signature that no longer type-checks. Report the file; do not edit files outside the scope.
- `markSynced` turns out to do more than remove keys by id (for example, it now updates counters), so that calling it twice is no longer harmless.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- An item the server always rejects still blocks every batch after it. Moving such an item aside after repeated failures is a possible follow-up; it needs a decision on where rejected items go and how the user sees them.
- Each accepted batch now costs one extra storage write (`markSynced`). With 50 items per batch this is small next to the network call.
- Reviewers: confirm `onAccepted` is awaited before the next batch starts.
