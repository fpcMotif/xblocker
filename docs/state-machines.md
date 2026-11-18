# XBlocker state machines

This file lists every explicit and implicit state machine in the extension. For each one it gives the states, the invariants, and a transition table. The last part lists the invalid states and transitions that the code could reach, with evidence, impact, fix status, and the GitHub issue.

Line references point at the code as of this document's last update. Test IDs (for example `BS-49`) name the regression test that pins the behavior.

## Execution contexts

The machines run in four kinds of JavaScript context. Each context has its own copy of every module singleton, so an in-memory flag or promise chain guards only its own context.

| Context                   | Count                        | Shares Web Locks  | Writes to `chrome.storage.local`                    |
| ------------------------- | ---------------------------- | ----------------- | --------------------------------------------------- |
| Content script (x.com)    | One per x.com tab            | No (x.com origin) | Blocked account map, whitelist, outbox items        |
| Popup                     | Zero or one                  | Yes               | Sync meta, `markSynced`, `mergeRemote`              |
| Options page              | Zero or more                 | Yes               | Whitelist, settings, sync meta, wipe                |
| Background service worker | Zero or one, evicted at will | Yes               | `syncDueAt`, sync meta, `markSynced`, `mergeRemote` |

`chrome.storage.local` has no transactions. A read-modify-write that spans two contexts can lose an update. Two rules follow from this:

1. A value that more than one context appends to must not be a single array. Each item gets its own key.
2. Cloud sync and cloud wipe must be serialized across extension contexts. `withCloudSyncLock` (`packages/sync/sync-engine.ts:121`) holds the Web Lock `xblocker-cloud-sync` for that.

## 1. Reply Rail (`entrypoints/content/rail.ts`)

Explicit machine. The state is `root.dataset.state`, set only by `setState` (`rail.ts:607`).

States: `collapsed`, `tracking`, `settled`.

Timers: dwell `DWELL_MS = 1000` (`rail.ts:27`), collapse grace `COLLAPSE_GRACE_MS = 600` (`rail.ts:28`).

| From                  | Event                                          | Guard                                            | To                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| `collapsed`           | Cursor enters a reply article                  | No open modal, no batch running                  | `tracking` (anchor set)       |
| `tracking`            | Follow loop tick                               | Cursor has stayed for `DWELL_MS` (`rail.ts:437`) | `settled`                     |
| any                   | Cursor enters the rail root                    | State is not `collapsed`                         | `settled`                     |
| any                   | Cursor over a suppressed target                | none                                             | `collapsed` (`collapseNow`)   |
| any                   | Cursor over a reply while a page modal is open | none                                             | `collapsed`                   |
| `tracking`, `settled` | Cursor leaves the replies                      | none                                             | grace timer armed             |
| any                   | Grace timer fires (`rail.ts:634`)              | none                                             | `collapsed`                   |
| `tracking`, `settled` | Batch is running                               | none                                             | `settled` (pinned, no follow) |
| any                   | Puck activated                                 | none                                             | `settled`                     |
| any                   | `destroy()`                                    | none                                             | removed from the DOM          |

Invariants:

- I-R1: While a batch runs, the rail never collapses under the cursor and never follows it (`rail.ts:311`).
- I-R2: The follow loop runs only in `tracking`. `settle` and `collapseNow` both stop it.
- I-R3: The grace timer is at most one timer. `scheduleCollapse` cancels the previous one first.
- I-R4: A rail starts a batch only when the shared runner is idle (`rail.ts:478`). See F4.

## 2. Action button (`entrypoints/content/buttons.ts`)

Explicit machine in `button.dataset.state`.

States: `idle`, `busy`, `success`, `error`.

| From                    | Event                           | Guard               | To                           |
| ----------------------- | ------------------------------- | ------------------- | ---------------------------- |
| `idle`                  | Click                           | Button not disabled | `busy`                       |
| `busy`                  | `onClick` resolves              | none                | `success`                    |
| `busy`                  | `onClick` rejects               | none                | `error`                      |
| `success`, `error`      | `STATE_RESET_MS = 1400` elapses | none                | `idle`                       |
| not `idle`, or disabled | Click                           | none                | no change (`buttons.ts:121`) |

Invariants:

- I-B1: `success` means the action did its work. An action that does nothing must reject. F4 broke this.
- I-B2: A disabled button never leaves `idle`.

## 3. Reply batch runner (`entrypoints/content/actions.ts`)

Implicit machine. One shared instance per content-script context (`actions.ts:354`).

Runner states: `idle`, `running`. The flag is `running` (`actions.ts:267`). It is claimed before the first `await` (`actions.ts:288`) and cleared in `finally` (`actions.ts:346`).

| From      | Event               | Guard                | To        | Result                                      |
| --------- | ------------------- | -------------------- | --------- | ------------------------------------------- |
| `idle`    | `run(type)`         | Page is a tweet page | `running` | summary                                     |
| `idle`    | `run(type)`         | Not a tweet page     | `idle`    | `null`                                      |
| `running` | `run(type)`         | none                 | `running` | `null` (re-entry refused, `actions.ts:281`) |
| `running` | Loop ends or throws | none                 | `idle`    | summary or rejection                        |

Per-account lifecycle (`runAccountLifecycle`, `actions.ts:226`), with at most `MAX_ACCOUNT_ATTEMPTS = 3` attempts:

| From         | Event                                                       | To                                     |
| ------------ | ----------------------------------------------------------- | -------------------------------------- |
| `pending`    | Skip rule matches (whitelist, thread author, research link) | `skipped`                              |
| `pending`    | No username resolves                                        | `unconfirmed`                          |
| `pending`    | Start                                                       | `acting`                               |
| `acting`     | Act returns or throws                                       | `confirming`                           |
| `confirming` | Relationship lookup says yes                                | `confirmed` (mark `xbBlocked`, record) |
| `confirming` | No or throw, attempt < 3                                    | `backoff`                              |
| `confirming` | No or throw, attempt = 3                                    | `unconfirmed`                          |
| `backoff`    | Delay elapses                                               | `acting`                               |

Backoff is `500 · 2^(n-1)` ms plus up to 250 ms of jitter. After a rate-limit-shaped failure it is `4000 · 2^(n-1)` ms plus up to 2000 ms. Accounts are spaced 250 ms apart (`actions.ts:53`).

Invariants:

- I-A1: At most one batch runs per tab.
- I-A2: An account is recorded only after confirmation. A failed act that X still applied is caught by the confirm step, so a retry never records twice.
- I-A3: `xbBlocked` on an article means a confirmed action. Other scanners use it to skip the author. F6 shows that this flag is set too late for Bot Sentry.

## 4. Quick-block auto-confirm (`entrypoints/content/quick-block.ts`)

Implicit machine. The state is `pendingNativeAction` plus the sheet watch timer.

States: `disarmed`, `armed(at)`.

| From       | Event                                     | Guard                                                               | To                             |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `disarmed` | User picks Block or Mute in X's own menu  | Auto-confirm mode                                                   | `armed` (watch starts)         |
| `armed`    | Confirm sheet appears                     | `now - at <= AUTO_CONFIRM_WINDOW_MS` (2000 ms, `quick-block.ts:47`) | `disarmed`, sheet clicked once |
| `armed`    | Confirm sheet appears                     | Window passed (`quick-block.ts:271`)                                | no click                       |
| `armed`    | Window timer fires (`quick-block.ts:146`) | none                                                                | `disarmed`                     |
| `armed`    | Any other user action                     | none                                                                | `disarmed`                     |

Invariants:

- I-Q1: An intent confirms at most one sheet. It is cleared and the sheet is marked `xbAutoConfirmed` before the click.
- I-Q2: A stale intent never confirms a later destructive sheet.

## 5. Bot Sentry (`entrypoints/content/auto-block.ts`)

Implicit machine. Instance flags: `scanning`, `rescanQueued`, `destroyed`. Per-article flags: `xbSpamScanned`, `xbBlocked`.

| From     | Event        | Guard              | To                            |
| -------- | ------------ | ------------------ | ----------------------------- |
| idle     | DOM mutation | `autoBlockSpam` on | scanning                      |
| scanning | DOM mutation | none               | scanning, `rescanQueued`      |
| scanning | Scan ends    | `rescanQueued`     | scanning again                |
| scanning | Scan ends    | not queued         | idle                          |
| any      | `destroy()`  | none               | destroyed, later work dropped |

Per article: `unscanned` → `scanned` (`auto-block.ts:108`, set before classification) → `blocked` (`auto-block.ts:157`) or left `scanned`.

Invariants:

- I-S1: Each article is classified once. A transient failure is not retried in that page view (by design, F7 note).
- I-S2: An article already marked `xbBlocked` is skipped (`auto-block.ts:122`).

## 6. Content surface lifecycle (`entrypoints/content/index.ts`)

Implicit machine driven by URL changes (`index.ts:163`).

| Page        | Event      | Result                                                               |
| ----------- | ---------- | -------------------------------------------------------------------- |
| Timeline    | URL change | Rail and Bot Sentry removed                                          |
| Status page | URL change | Old rail and Bot Sentry destroyed, new ones mounted (`index.ts:113`) |
| Other page  | URL change | Rail and Bot Sentry removed                                          |
| any         | Start      | Quick-block mounted once for the session (`index.ts:149`)            |

Invariants:

- I-L1: At most one rail and one Bot Sentry exist per tab.
- I-L2: The batch runner outlives the rail. A batch keeps running after its rail is destroyed. F4 and F8 come from this.

## 7. Whitelist modal and toast (`entrypoints/content/modal.ts`, `toast.ts`)

Modal flags: `submitting`, `closed` (`modal.ts:84`).

| From       | Event                   | Guard            | To                                    |
| ---------- | ----------------------- | ---------------- | ------------------------------------- |
| open       | Submit                  | not `submitting` | submitting                            |
| submitting | Submit                  | none             | ignored (`modal.ts:110`)              |
| submitting | Write settles           | none             | open, or closed on success            |
| open       | Escape, backdrop, close | none             | closed, removed after `MODAL_EXIT_MS` |

Toast: `open` → `closed` after `TOAST_DURATION_MS` or a dismiss, removed after `TOAST_EXIT_MS`.

## 8. Cloud sync session (`packages/sync/cloud-session.ts`)

Explicit owner state per session, plus the cross-context lock. Each surface creates its own session: the popup, each mount of the options Cloud pane, and the background worker.

Owner states: `none`, `auto`, `manual`, `wipe`.

| From                     | Event             | Guard           | To                                                                             |
| ------------------------ | ----------------- | --------------- | ------------------------------------------------------------------------------ |
| `none`                   | `runManual()`     | none            | `manual`, then waits for the lock (`cloud-session.ts:123`)                     |
| not `none`               | `runManual()`     | none            | refused, `null`                                                                |
| `none`                   | `runAutoOnOpen()` | none            | waits for the lock, then `auto` on first adapter load (`cloud-session.ts:153`) |
| not `none`               | `runAutoOnOpen()` | none            | refused, reports `syncing`                                                     |
| `none`                   | `wipeCloud()`     | none            | `wipe`, then waits for the lock (`cloud-session.ts:179`)                       |
| not `none`               | `wipeCloud()`     | none            | rejects "A sync is in progress"                                                |
| `auto`, `manual`, `wipe` | Task settles      | owner unchanged | `none`                                                                         |

Under the lock, an open-time sync and a worker sync re-read the backup flag (`isCloudBackupStillOn`, `sync-engine.ts:134`). They skip when a wipe turned it off.

The wipe under the lock runs in this order: clear the cloud rows, mark the pending blocked outbox synced, reset sync meta, set `cloudBackup` to `false`.

Invariants:

- I-C1: At most one sync or wipe runs across all extension contexts at a time (Web Lock). A session's owner flag only refuses work inside its own surface.
- I-C2: No sync pushes after a wipe has finished unless the user turned backup on again.
- I-C3: After a wipe, the cloud holds no blocked rows for the owner.

## 9. Background sync scheduler (`packages/sync/background-sync.ts`)

Implicit machine. In memory: `timer`. Persisted: `syncDueAt` (`background-sync.ts:35`), which survives worker eviction.

Timings: debounce 10 s (`background-sync.ts:28`), periodic alarm every 30 min (`entrypoints/background.ts:33`), stale threshold 15 min (`sync-engine.ts:140`).

| From    | Event                           | Guard                               | To                                       |
| ------- | ------------------------------- | ----------------------------------- | ---------------------------------------- |
| any     | Outbox key changes              | Key is an outbox item key           | `syncDueAt = now + 10 s`, timer re-armed |
| armed   | Timer fires                     | none                                | syncing                                  |
| any     | Worker starts or catch-up alarm | `syncDueAt` passed                  | syncing                                  |
| any     | Worker starts or catch-up alarm | `syncDueAt` in the future, no timer | timer armed for the rest                 |
| any     | Periodic alarm                  | none                                | syncing                                  |
| syncing | Sync succeeds                   | `syncDueAt` unchanged since start   | `syncDueAt` cleared                      |
| syncing | Sync succeeds                   | Re-armed during the sync            | `syncDueAt` kept                         |
| syncing | Sync fails                      | none                                | `syncDueAt` kept, retried later          |

Invariants:

- I-W1: A queued action is pushed within one debounce after the worker is alive, or by the next alarm.
- I-W2: The worker sync runs under the cloud lock (`runBackgroundCloudSync`, `background-sync.ts:152`).

## 10. Popup sync row (`entrypoints/popup/main.ts`)

Explicit `SyncRowState`: `off`, `unconfigured`, `idle`, `syncing`, `error` (`popup/main.ts:286`).

| From            | Event                       | To                                      |
| --------------- | --------------------------- | --------------------------------------- |
| start           | Build has no cloud config   | `unconfigured`                          |
| start           | Backup off                  | `off`                                   |
| start           | Backup on                   | `syncing` while the open-time sync runs |
| `syncing`       | Sync succeeds or is skipped | `idle`                                  |
| `syncing`       | Sync fails                  | `error`                                 |
| `idle`, `error` | "Sync now"                  | `syncing`                               |

## 11. Options Cloud pane (`entrypoints/options/panes/cloud.ts`)

Backup toggle: `on`, `off`. Wipe panel: `closed`, `open`, `confirming`, `failed`.

| From         | Event              | Guard          | To                                       |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| `closed`     | Wipe button        | none           | `open`                                   |
| `open`       | Typed word matches | none           | Confirm enabled                          |
| `open`       | Cancel or Escape   | Cancel enabled | `closed`                                 |
| `open`       | Confirm            | none           | `confirming` (both buttons disabled)     |
| `confirming` | Wipe resolves      | none           | `closed`, toggle `off`                   |
| `confirming` | Wipe rejects       | none           | `failed` (message shown, Cancel enabled) |
| `failed`     | Confirm or Cancel  | none           | `confirming` or `closed`                 |

## 12. Options navigation (`entrypoints/options/main.ts`)

`navToken` (`main.ts:235`) is a counter. Each navigation takes `++navToken`. A pane load that finishes with an older token drops its result and its error (`main.ts:252`, `main.ts:263`).

Invariant I-N1: Only the latest navigation renders a pane.

## 13. Stored data lifecycles

### Outbox item (`packages/storage/blocked-store.ts`, `whitelist-store.ts`)

Each queued cloud change is stored under its own key: `blockedOutbox:<actionId>` or `whitelistOutbox:<actionId>`. The legacy array keys `blockedOutbox` and `whitelistOutbox` are read and drained, never appended to.

| From   | Event                                         | To                                                   |
| ------ | --------------------------------------------- | ---------------------------------------------------- |
| absent | `record()`, whitelist add or remove, backfill | queued (same `storage.set` as the data it describes) |
| queued | Push acknowledged, `markSynced`               | removed                                              |
| queued | Wipe                                          | removed (blocked outbox only)                        |

Invariants:

- I-O1: No writer reads and rewrites the outbox. A writer adds keys and `markSynced` removes keys, so a stale copy can never erase an item.
- I-O2: `pending()` returns legacy items first, then keyed items sorted by `action.at`.
- I-O3: A failed storage read rejects. It never throws inside the chrome callback, so a mutation chain cannot wedge.

### Blocked account

States: `active`, `unblocked`. A pull merges by `clientActionId`, so a pushed action is idempotent.

### Whitelist entry

States: `active`, `removed`. A pull resolves conflicts last-write-wins by `updatedAt`.

## Findings

Ordered by impact. Every "Fixed" row has a regression test that failed on the old code.

| ID  | Impact | Finding                                                     | Status | Issue                                                 |
| --- | ------ | ----------------------------------------------------------- | ------ | ----------------------------------------------------- |
| F1  | High   | Cross-context outbox lost update                            | Fixed  | [#50](https://github.com/fpcMotif/xblocker/issues/50) |
| F3  | Medium | A failed read wedged the blocked-store chain                | Fixed  | [#50](https://github.com/fpcMotif/xblocker/issues/50) |
| F2  | High   | Wipe races a sync in another surface                        | Fixed  | [#51](https://github.com/fpcMotif/xblocker/issues/51) |
| F4  | Medium | Rail paints success for a refused batch                     | Fixed  | [#52](https://github.com/fpcMotif/xblocker/issues/52) |
| F5  | Medium | Account map and whitelist list lose updates across contexts | Open   | [#53](https://github.com/fpcMotif/xblocker/issues/53) |
| F6  | Low    | Bot Sentry and a bulk run record one block twice            | Open   | [#54](https://github.com/fpcMotif/xblocker/issues/54) |
| F7  | Low    | Options whitelist pane drops a row it failed to remove      | Open   | [#54](https://github.com/fpcMotif/xblocker/issues/54) |
| F8  | Low    | Rail session count loses a batch that ends after navigation | Open   | [#54](https://github.com/fpcMotif/xblocker/issues/54) |

### F1. Cross-context outbox lost update (breaks I-O1)

Before the fix, the outbox was one array per collection. The content script appended to it and the sync contexts shrank it, each in its own mutation chain:

1. Tab `record()` reads `[a]`.
2. Worker `markSynced([a])` reads `[a]`.
3. Tab writes `[a, b]`.
4. Worker writes `[]`. Action `b` is lost and never reaches the cloud.

Two x.com tabs recording at once lost actions the same way. The worker syncs 10 s after every outbox change, so a bulk run that crosses that point hits this race.

Evidence: `BS-49` (`packages/storage/tests/blocked-store.test.ts`) and `WL-28` (`packages/storage/tests/whitelist-store.test.ts`) replay the interleaving with two store instances. Both failed on the old code.

Fix: per-item outbox keys. See the outbox lifecycle above.

### F2. Wipe races a sync in another surface (breaks I-C1, I-C2, I-C3)

Each surface owned a separate session, and the owner flag was the only guard. A wipe in the options page could run while the popup, the worker, or an earlier mount of the Cloud pane was mid-push. The push landed after the wipe and put rows back. Moving Cloud → General → Cloud in the options page was enough to get a second session. A sync that had read `cloudBackup === true` before the wipe also pushed after it.

Evidence: `CS-30` (cloud kept 1 row on the old code), `CS-31`, and `BG-17`.

Fix: `withCloudSyncLock` around every sync and the wipe, plus `isCloudBackupStillOn` under the lock.

### F3. A failed read wedged the blocked-store chain (breaks I-O3)

`readKey` threw inside the `chrome.storage.local.get` callback when no result came back. Real Chrome calls that callback asynchronously, so the throw escaped the promise. The promise never settled and every later mutation in that tab waited forever.

Evidence: `BS-50`.

Fix: `readKey` and `storageGetAll` (`packages/storage/chrome-storage.ts`) reject through `reject`.

### F4. Rail paints success for a refused batch (breaks I-B1)

After an in-app navigation mid-batch, the new rail did not know a batch was running. A click on its other bulk button reached the runner, which returned `null`. `runBatch` treated `null` as done, so the button showed `success` though nothing ran.

Evidence: `RA-21` (`test/content/rail-actions.test.ts`).

Fix: `runBatch` checks `isBatchRunning()` first, shows an info toast, and rejects (`rail.ts:478`).

### F5. Account map and whitelist list lose updates across contexts (open)

`blockedAccounts` and `whitelist` are still one key each. Two tabs recording at once, a tab recording while a pull runs `mergeRemote`, or the x.com modal and the options pane adding at once can each drop one write. With cloud backup on, the queued outbox item survives (F1 fix) and the next pull restores the account. With backup off, the loss is permanent.

Evidence: code reading. The chain-scope comment in `createBlockedStore` (`blocked-store.ts:146`) states the race. The interleaving is the one `BS-49` replays for the outbox.

### F6. Bot Sentry and a bulk run record one block twice (open)

Bot Sentry skips an article only when `xbBlocked` is set (`auto-block.ts:122`). The batch runner sets it after the confirm step (`actions.ts:322`). With `autoBlockSpam` on, both paths can act on one author during a "Block all" run. The ledger then counts two blocks.

### F7. Options whitelist pane drops a row it failed to remove (open)

`removeFromWhitelist` returns without writing when its read fails. `commitRemove` (`entrypoints/options/panes/whitelist.ts:181`) still removes the row from the table. The handle stays whitelisted but is hidden until reload.

### F8. Rail session count loses a batch that ends after navigation (open)

The summary calls `incrementBlocked` on the rail that started the batch (`rail.ts:502`). After a navigation that rail is gone, so the new rail's count misses those blocks.

### Checked and not reachable

- Opening the whitelist modal twice would leak a `keydown` listener. The modal backdrop (z-index 10002) covers the rail (10000), so the second open cannot be clicked.
- Bot Sentry marks an article scanned before it acts, so a transient failure is not retried in that page view. This is intended: a retry would re-classify on every DOM mutation.
