# Plan 001: The Bot Sentry does no work while auto-block is off

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c7bf141..HEAD -- entrypoints/content/auto-block.ts test/content/auto-block.test.ts`
> This plan was written against commit `c7bf141` plus uncommitted working-tree
> edits on branch `feat/options-page-polish`. The excerpts under "Current
> state" are the authority. If the live code does not match them, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `c7bf141` (plus uncommitted working tree), 2026-11-17

## At a glance

The Bot Sentry watches every DOM change on a tweet page and reads `chrome.storage` on each one, even when its setting is off, which is the default. This plan makes it read the setting once, follow setting changes through a storage event, and attach its DOM observer only while the setting is on. Classification, whitelist checks, pacing, and blocking stay unchanged.

## Why this matters

x.com mutates the DOM many times per second while the user scrolls. Each mutation batch calls `scan()`, and each scan awaits `readSettings()`, which is a cross-process storage read. With auto-block off, that read is the only thing the scan does. The owner wants the extension to cost less CPU and memory on x.com tabs. After this plan, a tab with auto-block off has no Bot Sentry observer and performs no Bot Sentry storage reads after mount.

## Current state

- `entrypoints/content/auto-block.ts` — the `SpamAutoBlocker` class (167 lines). Mounted per tweet page by `entrypoints/content/index.ts` (`addButtons()`), destroyed on navigation.
- `packages/storage/settings.ts` — `readSettings()`, `normalizeSettings()`, the `Settings` type. `autoBlockSpam` defaults to `false`.
- `packages/storage/chrome-storage.ts` — exports `SETTINGS_KEY = "settings"`.
- `test/content/auto-block.test.ts` — tests `AB-01` … `AB-16`, `AB-20`, `AB-21` (with `AB-07b`, `AB-11b`). New tests start at `AB-30`.

`entrypoints/content/auto-block.ts:54-66` today:

```ts
  mount(): void {
    this.observer = new MutationObserver(() => {
      this.scan();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scan();
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
  }
```

`entrypoints/content/auto-block.ts:87-96` today:

```ts
  private async runScan(): Promise<void> {
    const settings = await readSettings();
    // destroy() can land while this read was in flight (e.g. a fast navigate-away right
    // after mount's own initial scan) -- disconnecting the observer doesn't reach back
    // into an already-started scan, so this checks explicitly before touching the DOM.
    if (this.destroyed || !settings.autoBlockSpam) {
      // Nothing is marked scanned while the setting is off, so turning it on later
      // re-considers every reply currently on the page, not just future ones.
      return;
    }
```

The existing pattern for a guarded storage subscription is `packages/storage/blocked-store.ts:333-349`:

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
        ...
      };
      onChanged.addListener(listener);
      return () => onChanged.removeListener(listener);
    },
```

Match that guard. The test environment's chrome fake (`test/setup.ts`) has no `chrome.storage.onChanged`, so the guard path runs in most tests.

Repo conventions that bind this work:

- Do not add, edit, or delete code comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. Carry intent in names and tests. A comment may leave only together with the code it describes.
- Do not add lint suppressions (`eslint-disable`, `@ts-expect-error`). Fix the error.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test, or `bun test` fails.
- Content-script code imports from `packages/storage/*` root files and from `entrypoints/lib`. It must not import from `entrypoints/options`.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test test/content/auto-block.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope** (the only files you may modify):

- `entrypoints/content/auto-block.ts`
- `test/content/auto-block.test.ts`

**Out of scope** (do NOT touch):

- `entrypoints/content/spam-classifier.ts` — classification rules are a separate concern.
- `entrypoints/content/index.ts` — the mount and destroy call sites keep their current shape.
- `packages/storage/settings.ts` — the settings reader stays as it is.
- `entrypoints/content/quick-block.ts` — it already observes only while armed.

## Git workflow

- Branch: `advisor/001-gate-bot-sentry-observer`
- One commit. Message style is conventional commits, for example: `fix(sync): page the cloud pull and wipe past Convex's array limit`. Use `perf(content): ...` here.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the failing tests first

Add these tests to `test/content/auto-block.test.ts`, following the structure of `AB-01`:

- **AB-30**: with the setting off, after `mount()` and `settle()`, appending a node to `document.body` causes zero additional `chrome.storage.local.get` calls. Count calls by wrapping `chrome.storage.local.get` for the test and restoring it afterwards.
- **AB-31**: with the setting off, `mount()` attaches no `MutationObserver`. Assert through behavior: set `storageFake.data["settings"] = { autoBlockSpam: true }` without firing a change event, append a spam reply, settle, and expect no fetch.
- **AB-32**: with a stubbed `chrome.storage.onChanged` (see how test `BS-25` in `packages/storage/tests/blocked-store.test.ts` installs a fake `onChanged` and fires it), firing a `settings` change to `{ autoBlockSpam: true }` in area `"local"` makes the blocker scan the replies already on the page and block the spam one.
- **AB-33**: firing a `settings` change back to `{ autoBlockSpam: false }` stops further scans. A spam reply appended afterwards is not blocked.
- **AB-34**: `destroy()` removes the storage listener. The fake's listener list is empty afterwards.
- **AB-35**: a change in area `"sync"`, or a change that has no `settings` key, is ignored.

**Verify**: `bun test test/content/auto-block.test.ts` → the new tests fail, the existing ones pass.

### Step 2: Cache the settings and gate the observer

Change `SpamAutoBlocker` in `entrypoints/content/auto-block.ts`:

1. Add a private field `settings: Settings | null = null` and a private field `unsubscribeSettings: (() => void) | null = null`.
2. `mount()` must subscribe to settings changes (item 3), then start one `readSettings()` call with `void`. When it resolves, store the result and call a new private method `applySettings()`. `mount()` stays synchronous.
3. Add a private `subscribeToSettings()` that uses the guard pattern quoted above. Its listener ignores every event whose `areaName` is not `"local"` or that has no `SETTINGS_KEY` entry. Otherwise it stores `normalizeSettings(change.newValue)` and calls `applySettings()`. Import `SETTINGS_KEY` from `../../packages/storage/chrome-storage` and `normalizeSettings` from `../../packages/storage/settings`.
4. `applySettings()` must do nothing when `this.destroyed` is true. When `settings.autoBlockSpam` is true and no observer exists, it creates the `MutationObserver` on `document.body` with `{ childList: true, subtree: true }` and calls `this.scan()`. When `autoBlockSpam` is false and an observer exists, it disconnects the observer and sets it to `null`.
5. `runScan()` must use the cached `this.settings` and must not call `readSettings()` when the cache is filled. If `this.settings` is `null`, read it once and store it, so a direct `scan()` call in a test that never called `mount()` still works. Keep the existing `this.destroyed || !settings.autoBlockSpam` early return.
6. `destroy()` must also call and clear `unsubscribeSettings`.

Keep the `scanning` / `rescanQueued` logic exactly as it is.

**Verify**: `bun test test/content/auto-block.test.ts` → all tests pass, including every existing test unchanged.

### Step 3: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- New tests `AB-30` … `AB-35` as listed in step 1, in `test/content/auto-block.test.ts`.
- Structural pattern: `AB-01` in the same file for setup, and `BS-25` in `packages/storage/tests/blocked-store.test.ts` for the fake `onChanged`.
- Each new test must fail before step 2 and pass after it.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` exits 0
- [ ] `bun test` exits 0 with tests `AB-30` … `AB-35` present and passing
- [ ] `git status --short` lists only the two in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The code at the quoted locations does not match the excerpts.
- An existing `AB-*` test fails after step 2 and the cause is not the cached settings read.
- The fix seems to need a change in `entrypoints/content/index.ts` or `packages/storage/settings.ts`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- A setting change now reaches an open tab through `chrome.storage.onChanged`. If the settings blob ever moves to another storage area, update the `areaName` check.
- While auto-block is on, every mutation batch still runs `getConversationReplies()`. Coalescing those scans to one per animation frame is a possible follow-up. It was left out to keep this change small.
- `entrypoints/content/index.ts:188-195` keeps a document-wide `MutationObserver` to detect URL changes. Its callback is one string comparison. Replacing it with the Navigation API was considered and deferred, because isolated-world support was not verified.
