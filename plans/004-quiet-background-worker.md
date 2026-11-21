# Plan 004: The background worker wakes and syncs only when there is work

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- entrypoints/background.ts packages/sync/background-sync.ts packages/sync/sync-engine.ts`
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

The background service worker schedules sync work that it does not need: its own outbox clean-up triggers a second wake, it schedules while cloud backup is off, it resets its periodic alarm on every start, and every 30-minute alarm does a full cloud pull because the staleness window is 15 minutes. This plan removes those four causes. What a sync does once it runs, and the popup's 15-minute staleness rule, stay unchanged.

## Why this matters

The owner wants the extension to use less memory and CPU in the background. Each needless wake loads the worker, reads storage, and sometimes pulls every cloud row. With nothing to push, the worker currently performs up to 48 full pulls per day. After this plan a quiet worker stays asleep, and a background pull with an empty outbox happens at most once per 6 hours.

## Current state

- `entrypoints/background.ts` — the service-worker entry (48 lines). Wires storage and alarm events to the scheduler.
- `packages/sync/background-sync.ts` — the scheduler (`createBackgroundSyncScheduler`), `runBackgroundCloudSync`, `readCloudBackupEnabled`, and the constants.
- `packages/sync/sync-engine.ts` — `SYNC_STALE_MS`, `shouldAutoSync`, `runAutoCloudSync`, `runAutoCloudSyncAll`.
- Tests: `packages/sync/tests/background-sync.test.ts` (`BG-*`), `packages/sync/tests/sync-engine.test.ts`.

`entrypoints/background.ts:27-36` today:

```ts
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !Object.keys(changes).some(isSyncedOutboxKey)) return;
    scheduler.onOutboxChanged();
  });

  // chrome.alarms survives service-worker teardown, unlike a plain timer.
  void chrome.alarms?.create(PERIODIC_SYNC_ALARM, { periodInMinutes: PERIODIC_SYNC_MINUTES });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    scheduler.onAlarm(alarm.name);
  });
```

`packages/sync/background-sync.ts:86-103` today:

```ts
  async function syncIfEnabled(): Promise<void> {
    try {
      // Captured before the push so the clear below can tell the debounce this sync
      // settles apart from one re-armed mid-flight: a re-arm means actions queued
      // after this sync read the outbox, and its due-at must survive to fire later.
      const settling = await readDueAt();
      if (!(await deps.isEnabled())) return;
      await deps.sync();
      if (settling !== undefined && (await readDueAt()) === settling) {
        await writeDueAt(undefined);
      }
    } catch (error) {
      // Background syncs are best-effort: the outbox keeps the actions, and the next
      // debounce/alarm/popup-open retries idempotently. The due-at is left in place on
      // failure so the next catch-up check retries this sync too.
      console.warn("XBlocker background sync failed:", error);
    }
  }
```

`packages/sync/background-sync.ts:124-128` today:

```ts
  return {
    onOutboxChanged() {
      void writeDueAt(now() + debounceMs);
      armTimer(debounceMs);
    },
```

`packages/sync/background-sync.ts:149-155` today:

```ts
export function runBackgroundCloudSync(
  loadAdapter?: AnyAdapterLoader,
): Promise<SyncOutcome | { status: "skipped" }> {
  return withCloudSyncLock(async () =>
    runAutoCloudSyncAll(await readCloudBackupEnabled(), Date.now, loadAdapter),
  );
}
```

`packages/sync/sync-engine.ts:140` and `:167-176` today:

```ts
export const SYNC_STALE_MS = 15 * 60 * 1000;
```

```ts
export function shouldAutoSync(
  enabled: boolean,
  pendingCount: number,
  meta: SyncMeta,
  now: number,
): boolean {
  if (!enabled) return false;
  if (pendingCount > 0) return true;
  return typeof meta.lastSyncAt !== "number" || now - meta.lastSyncAt > SYNC_STALE_MS;
}
```

`packages/sync/sync-engine.ts:274-295` today:

```ts
export async function runAutoCloudSyncAll(
  enabled: boolean,
  now: () => number = Date.now,
  loadAdapter?: AnyAdapterLoader,
  onWillSync?: () => void,
): Promise<SyncOutcome | { status: "skipped" }> {
  const nowValue = now();
  const due = await Promise.all(
    SYNCED_COLLECTIONS.map(async (collection) => {
      const [pending, meta] = await Promise.all([
        collection.store.pending(),
        getSyncMeta(collection.metaKey),
      ]);
      return shouldAutoSync(enabled, pending.length, meta, nowValue);
    }),
  );
  if (!due.some(Boolean)) {
    return { status: "skipped" };
  }
  onWillSync?.();
  return runCloudSyncAll(now, loadAdapter);
}
```

Mechanism of each problem:

1. `markSynced` removes outbox keys. A removal is a storage change whose key matches `isSyncedOutboxKey`, so every finished sync schedules another wake 10 seconds later.
2. `onOutboxChanged` writes `syncDueAt` and arms a timer before checking whether backup is enabled. With backup off, the `syncDueAt` key is never cleared, so every worker start runs the catch-up path.
3. `chrome.alarms.create` with an existing name replaces the alarm and restarts its period. It runs on every worker start.
4. `PERIODIC_SYNC_MINUTES = 30` is longer than `SYNC_STALE_MS` (15 minutes), so each alarm finds the data stale and pulls everything.

Design decision recorded in `docs/adr/0003-sync-policy-and-cloud-adapter.md`: one policy function, `shouldAutoSync`, gates every automatic sync. This plan keeps that single function and adds an optional staleness parameter to it. It does not add a second policy function.

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. A comment may leave only together with the code it describes.
- Do not edit any Markdown file except the status row in `plans/README.md`.
- Do not add lint suppressions or `as` type assertions.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test packages/sync/tests` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `entrypoints/background.ts`
- `packages/sync/background-sync.ts`
- `packages/sync/sync-engine.ts` (only `shouldAutoSync`, `runAutoCloudSync`, `runAutoCloudSyncAll` signatures)
- `packages/sync/tests/background-sync.test.ts`
- `packages/sync/tests/sync-engine.test.ts`

**Out of scope** (do NOT touch):

- `packages/sync/cloud-session.ts` and the popup — they keep the 15-minute default.
- `packages/sync/lib/convex-sync.ts` and anything under `convex/`.
- `docs/adr/0003-sync-policy-and-cloud-adapter.md` — report the needed text change; do not edit it.
- `packages/storage/**`.

## Git workflow

- Branch: `advisor/004-quiet-background-worker`
- One commit per step. Conventional style, for example `perf(sync): stop the worker re-waking on its own outbox clean-up`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Ignore outbox removals

In `entrypoints/background.ts`, change the storage listener so it calls `scheduler.onOutboxChanged()` only when at least one changed key satisfies both `isSyncedOutboxKey(key)` and `changes[key].newValue !== undefined`.

Add a `BG-*` test in `packages/sync/tests/background-sync.test.ts` next to the existing entrypoint-wiring tests (find them with `rg -n "startBackgroundSync" packages/sync/tests`): a change event that only removes an outbox key (`{ oldValue: item }`, no `newValue`) does not schedule; one with `newValue` does.

**Verify**: `bun test packages/sync/tests/background-sync.test.ts` → all pass.

### Step 2: Do not schedule while backup is off

In `packages/sync/background-sync.ts`:

1. `onOutboxChanged()` must check `deps.isEnabled()` first. When it resolves `false`, write nothing and arm nothing. When `true`, write the due-at and arm the timer as today. The method keeps its `() => void` signature; run the async part with `void`.
2. In `syncIfEnabled`, when `deps.isEnabled()` resolves `false` and a due-at is stored, clear it with `writeDueAt(undefined)` before returning.

Add tests:

- With backup disabled, `onOutboxChanged()` writes no `syncDueAt` key and never calls `sync`.
- With backup disabled and a stale `syncDueAt` already stored, scheduler start-up (the catch-up path) clears the key.
- The existing coalescing test `BG-01` still passes.

**Verify**: `bun test packages/sync/tests/background-sync.test.ts` → all pass.

### Step 3: Create the alarm only when it is missing

In `entrypoints/background.ts`, replace the unconditional `chrome.alarms?.create(...)` with: call `chrome.alarms.get(PERIODIC_SYNC_ALARM)`, and create the alarm only when the result is `undefined` or its `periodInMinutes` differs from `PERIODIC_SYNC_MINUTES`. Keep the optional chaining on `chrome.alarms` and keep the existing comment above the code.

Add tests: an existing alarm with the same period is not recreated; a missing alarm is created; an alarm with a different period is replaced.

**Verify**: `bun test packages/sync/tests/background-sync.test.ts` → all pass.

### Step 4: Give the background its own staleness window

1. In `packages/sync/sync-engine.ts`, add a fifth parameter to `shouldAutoSync`: `staleMs: number = SYNC_STALE_MS`, and use it in place of `SYNC_STALE_MS` in the comparison.
2. Add a matching optional trailing parameter `staleMs?: number` to `runAutoCloudSync` and `runAutoCloudSyncAll`, and pass it through to `shouldAutoSync`. Callers that omit it keep today's behavior.
3. In `packages/sync/background-sync.ts`, add and export `export const BACKGROUND_SYNC_STALE_MS = 6 * 60 * 60 * 1000;` and pass it from `runBackgroundCloudSync` as the `staleMs` argument of `runAutoCloudSyncAll` (pass `undefined` for `onWillSync`).

Add tests:

- `shouldAutoSync(true, 0, { lastSyncAt: 0 }, SYNC_STALE_MS + 1)` is still `true` with the default.
- `shouldAutoSync(true, 0, { lastSyncAt: 0 }, SYNC_STALE_MS + 1, BACKGROUND_SYNC_STALE_MS)` is `false`.
- `shouldAutoSync(true, 1, { lastSyncAt: 0 }, 1, BACKGROUND_SYNC_STALE_MS)` is `true` (pending work always syncs).
- `runBackgroundCloudSync` with a last sync 20 minutes old and an empty outbox resolves `{ status: "skipped" }`.

**Verify**: `bun test packages/sync/tests` → all pass.

### Step 5: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- Tests listed in steps 1-4, in the two in-scope test files.
- Structural pattern: `BG-01` in `packages/sync/tests/background-sync.test.ts` (uses `makeDeps`, `debounceMs: 0`, and `settleTimersAndMicrotasks`).

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the new tests present and passing
- [ ] `rg -n "BACKGROUND_SYNC_STALE_MS" packages/sync/background-sync.ts` shows the constant and its use
- [ ] `rg -n "alarms\?\.create|alarms\.create" entrypoints/background.ts` shows one call, inside the "missing or different period" branch
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated
- [ ] Your final report states the sentence that `docs/adr/0003-sync-policy-and-cloud-adapter.md` must gain: "The background worker passes a 6-hour staleness window to `shouldAutoSync`; the popup keeps the 15-minute default."

## STOP conditions

Stop and report back if:

- The quoted code does not match the live files.
- An existing test asserts that a periodic alarm with an empty outbox syncs after 15 minutes. That test encodes the old policy; report it and wait for the owner's decision before changing it.
- `chrome.alarms.get` is not available on the test fake and cannot be stubbed inside the test file without editing `test/setup.ts`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Step 4 is a policy change: changes made on another device now reach this device's local list within 6 hours in the background, or at once when the popup opens. The owner was told about the 6-hour window before this plan was written and did not object. The number is one constant and can change.
- A failing deployment still retries on every outbox change with no backoff. Adding a stored failure count and next-attempt time is a possible follow-up.
- Reviewers: check that a sync started from the popup no longer wakes the worker 10 seconds later.
