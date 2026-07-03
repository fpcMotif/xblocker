# XBlocker Test Plan

Comprehensive unit test design for the Chrome extension. All tests are TypeScript
(`test/**/*.test.ts`), run on `bun test`, and target **100% coverage** of the
extension's own source (`entrypoints/`). The threshold is enforced in
`bunfig.toml` (`coverageThreshold = 1.0`).

## Scope

Two source units exist; there is **no Convex / backend code** in this repo
(verified by search), so there are no Convex actions to simulate. "Backend"
here is the extension's only persistence and network surface:

- **`chrome.storage.local`** — the whitelist/settings store. Simulated by a
  stateful fake (`FakeChromeStorageArea` in `test/setup.ts`) whose `set()`
  writes are observable by later `get()` calls, supports failure injection, and
  a manual-dispatch mode to expose read-modify-write races.
- **X.com block API** (`fetch` to `api.x.com/1.1/blocks/create.json`) — the
  "Convex-action-like" remote call. Simulated by `installFetchStub` /
  `installRejectingFetch`, asserting URL, method, headers, CSRF token, and body.

## Harness

| File | Purpose |
| --- | --- |
| `test/setup.ts` | happy-dom globals, stateful `chrome.storage` fake, `setWindowLocation`/`setDocumentCookie`/`resetTestEnvironment` |
| `test/helpers/content-hooks.ts` | Loads `content/index.ts` once in `__XB_TEST__` mode, exposes internals + DOM/fetch builders |
| `test/helpers/timers.ts` | Manual / immediate `setTimeout` control + microtask draining |

`content/index.ts` exposes its internals via `globalThis.__xblockerTestHooks` only when
`__XB_TEST__` is set — the production bundle never installs them.

## Coverage map (file → suites)

| Source symbol | Test file | IDs |
| --- | --- | --- |
| `normalizeUsername`, `extractUsernameFromTweet` | `content/username.test.ts` | UN-01..15, EX-01..10 |
| `isTweetPageUrl`, `getCookieValue` | `content/url-and-cookies.test.ts` | URL-01..07, CK-01..08 |
| `createDirectBlockRequest`, `blockUserDirectly`, `blockTweet` | `content/direct-block.test.ts` | DB-01..11, BT-01..07 |
| `blockFirst20CommentTweets`, `muteFirst50CommentTweets`, `muteTweet` | `content/bulk-actions.test.ts` | BULK-01..13 |
| `getWhitelist`, `saveWhitelist`, `addToWhitelist` | `content/whitelist-storage.test.ts` | WL-01..12 |
| `detectTheme`, `applyTheme`, `ensureStyles`, `createIcon`, `createActionButton`, `showToast`, `showWhitelistModal` | `content/ui-rendering.test.ts` | TH/ST/IC/BT/TO/MD |
| `computeRailY`, `exceedsJitter`, `lerp` (pure geometry) | `content/position.test.ts` | RAIL/JIT/LERP/CONST |
| `ReplyRail` state machine (collapsed/tracking/settled, dwell, grace, suppression, follow loop) | `content/rail-state.test.ts` | RS-01..21 |
| `ReplyRail` actions (bulk batches, counts, ring, drag persistence, session badge) | `content/rail-actions.test.ts` | RA-01..15 |
| `isReplyArticle` classification + coverage attribution warm-up | `content/misc-coverage.test.ts` | MC-01..05 |
| `checkPageAndAddButton`, `addButtons`, `observeThemeChanges`, `initializeXBlocker`, test hooks | `content/page-lifecycle.test.ts` | PL-01..21 |
| `renderPopup`, popup whitelist form, settings toggles, `normalizeUsername` | `popup/popup.test.ts` | PU-01..13 |

## Adversarial cases & pinned bugs

These tests deliberately probe edge cases. Several **pin current buggy behavior**
so a future fix flips the assertion (search `BUG XB-BUG`):

- **XB-BUG-02** (BT-03, WL-07): fixed — whitelist matching ignores handle
  casing; the tests assert the skip.
- **XB-BUG-03** (WL-11, MD-06): fixed — `addToWhitelist` and the modal
  normalize and validate before storing, so entries always match extracted
  handles.
- **XB-BUG-04** (BULK-03): `blockFirst20CommentTweets` actually caps at 50.
- **XB-BUG-05** (PU-11): popup remove filters all identical handles at once.
- **XB-BUG-07** (URL-04): tweet-URL regex is unanchored.
- **XB-BUG-08** (WL-12, WL-17, WL-18, MD-11): fixed — whitelist mutations are
  serialized through a single promise chain and the save is aborted when the
  storage read fails.
- **XB-BUG-09** (BS-36..39, PU-CB-01): fixed — the cloud outbox is stored one
  item per storage key (`blockedOutbox:<actionId>`), so the sync side's
  markSynced removes exactly the synced keys instead of read-filter-writing one
  array. Previously a content-script record() landing between that read and
  write in another JS context was silently dropped and its action never reached
  the cloud backup. Legacy array outboxes are migrated on first read.

Other harsh inputs: boundary handle lengths (1/15/16 chars), reserved paths
(case-insensitive), unicode/emoji/injection-shaped handles, empty/duplicate
cookies, `ct0` missing vs empty, HTTP 401/429/403, network rejection, fetch
never attempted when request construction fails, zero-reply pages, missing
author links, absent X menus, storage get/set failures, idempotent rendering.

## Running

```sh
bun test              # all suites
bun test --coverage   # enforce the 100% threshold
```
