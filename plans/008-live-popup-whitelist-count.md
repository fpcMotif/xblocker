# Plan 008: The popup's whitelist count follows storage changes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- entrypoints/popup/main.ts packages/storage/whitelist-store.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. The excerpts under "Current
> state" are the authority. If the live code does not match them, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 005 delivers the popup's cheap blocked and muted counts; this plan covers the whitelist count only)
- **Category**: perf
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

The popup shows three numbers. The blocked and muted numbers update while the popup is open; the whitelist number is set once and then goes stale. This plan adds a whitelist-count subscription to the whitelist store and uses it in the popup. The popup's layout, its first paint, and the blocked and muted counters stay unchanged.

## Why this matters

A count that does not move after the user whitelists a handle from the page looks broken. The fix is small because Chrome already delivers the new whitelist array with each change event, so the count needs no extra read.

This plan does not reduce what the popup loads at open. The blocked and muted counts load the whole blocked list today; plan 005 replaces that with one small key and needs no popup change. The whitelist is an array of short strings and is read once.

## Current state

- `entrypoints/popup/main.ts` — the popup (525 lines). `renderPopup` starts at line 436.
- `packages/storage/whitelist-store.ts` — the whitelist store. Exports `getWhitelist`, `addToWhitelist`, and others. It has no change subscription today.
- `packages/storage/chrome-storage.ts` — exports `WHITELIST_KEY = "whitelist"`.
- `packages/storage/blocked-store.ts:333-349` — `onChange`, the pattern to copy for a guarded subscription.
- Tests: `test/popup/popup.test.ts`, `packages/storage/tests/whitelist-store.test.ts`.

`entrypoints/popup/main.ts:439-444` today:

```ts
  const [settings, whitelist, cloudBackupEnabled, stats] = await Promise.all([
    readSettings(),
    getWhitelist(),
    storageGet<boolean>(CLOUD_BACKUP_KEY).then((value) => value === true),
    blockedStore.stats(),
  ]);
```

`entrypoints/popup/main.ts:468-475` today:

```ts
  statStrip.blockedLive.set(stats.blocked);
  statStrip.mutedLive.set(stats.muted);
  statStrip.whitelistLive.set(whitelist.length);

  blockedStore.onChange((next: BlockedStats) => {
    statStrip.blockedLive.set(next.blocked);
    statStrip.mutedLive.set(next.muted);
  });
```

The subscription pattern, `packages/storage/blocked-store.ts:333-349` today (plan 005 changes which key it watches; the guard shape stays):

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

`packages/storage/whitelist-store.ts:65-76` today (how the stored value is validated on read):

```ts
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
```

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work.
- Do not add lint suppressions or `as` type assertions.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- Popup code imports from `packages/storage/*` root files. It must not import from `entrypoints/options`.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test test/popup/popup.test.ts packages/storage/tests/whitelist-store.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `packages/storage/whitelist-store.ts` (one new exported function)
- `entrypoints/popup/main.ts` (the subscription after line 475)
- `packages/storage/tests/whitelist-store.test.ts`
- `test/popup/popup.test.ts`

**Out of scope** (do NOT touch):

- `packages/storage/blocked-store.ts` — plan 005 owns it.
- The `WhitelistStore` type and `createWhitelistStore` — the new function is a module-level export beside `getWhitelist`, since it holds no mutation state.
- The popup's styles and markup.
- `entrypoints/options/**`.

## Git workflow

- Branch: `advisor/008-live-popup-whitelist-count`
- One commit. Conventional style, for example `fix(popup): keep the whitelist count live`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the subscription to the whitelist store

In `packages/storage/whitelist-store.ts`, next to `getWhitelist`, add and export:

```ts
export function onWhitelistCountChange(callback: (count: number) => void): () => void
```

It uses the same guard as the blocked store's `onChange`. Its listener ignores events whose `areaName` is not `"local"` or that have no `WHITELIST_KEY` entry. Otherwise it calls `callback(Array.isArray(change.newValue) ? change.newValue.length : 0)`. It returns an unsubscribe function.

Add tests to `packages/storage/tests/whitelist-store.test.ts` (install a fake `chrome.storage.onChanged` the way test `BS-25` in `packages/storage/tests/blocked-store.test.ts` does):

- A `"local"` change with an array value reports its length.
- A removed key (no `newValue`) reports 0.
- A `"sync"` area change and a change without the whitelist key are ignored.
- Without `chrome.storage.onChanged` the function returns a callable no-op.
- The returned unsubscribe removes the listener.

**Verify**: `bun test packages/storage/tests/whitelist-store.test.ts` → all pass.

### Step 2: Use it in the popup

In `entrypoints/popup/main.ts`, directly after the `blockedStore.onChange(...)` block, add:

```ts
  onWhitelistCountChange((count) => {
    statStrip.whitelistLive.set(count);
  });
```

Import `onWhitelistCountChange` from the same module `getWhitelist` is imported from.

Add a test to `test/popup/popup.test.ts`, modeled on the existing test near line 202 that fires a `blockedAccounts` change through fake listeners: fire `{ whitelist: { newValue: ["a", "b", "c"] } }` in area `"local"`, let the live number settle the way that test does, and expect the whitelist stat to read `3`.

**Verify**: `bun test test/popup/popup.test.ts` → all pass.

### Step 3: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- Five store tests (step 1) and one popup test (step 2).
- Structural patterns named in each step.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the six new tests present and passing
- [ ] `rg -n "onWhitelistCountChange" entrypoints/popup/main.ts packages/storage/whitelist-store.ts` shows the definition and one use
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The quoted code does not match the live files (plan 005 changing `ACCOUNTS_KEY` to a stats key inside `onChange` is expected and fine).
- The popup test near line 202 no longer exists or uses a different mechanism to fire storage changes.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The popup is short-lived, so the listener is never removed. If the popup ever gains a teardown path, call the returned unsubscribe there.
- The options Whitelist pane could use the same subscription to stay current while open. That is a separate change.
