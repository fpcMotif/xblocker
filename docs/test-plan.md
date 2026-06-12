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
| `test/helpers/content-hooks.ts` | Loads `content.ts` once in `__XB_TEST__` mode, exposes internals + DOM/fetch builders |
| `test/helpers/timers.ts` | Manual / immediate `setTimeout` control + microtask draining |

`content.ts` exposes its internals via `globalThis.__xblockerTestHooks` only when
`__XB_TEST__` is set — the production bundle never installs them.

## Coverage map (file → suites)

| Source symbol | Test file | IDs |
| --- | --- | --- |
| `normalizeUsername`, `extractUsernameFromTweet` | `content/username.test.ts` | UN-01..15, EX-01..10 |
| `isTweetPageUrl`, `getCookieValue` | `content/url-and-cookies.test.ts` | URL-01..07, CK-01..08 |
| `createDirectBlockRequest`, `blockUserDirectly`, `blockTweet` | `content/direct-block.test.ts` | DB-01..11, BT-01..07 |
| `blockFirst20CommentTweets`, `muteFirst50CommentTweets`, `muteTweet` | `content/bulk-actions.test.ts` | BULK-01..13 |
| `getWhitelist`, `saveWhitelist`, `addToWhitelist` | `content/whitelist-storage.test.ts` | WL-01..12 |
| `detectTheme`, `createActionIcon`, `addButtons`, `showToast`, `showWhitelistModal`, `createReplyActionButton` | `content/ui-rendering.test.ts` | TH/IC/AB/TO/MD/RB |
| `checkPageAndAddButton`, `observeThemeChanges`, `initializeXBlocker` | `content/page-lifecycle.test.ts` | PL-01..08 |
| `renderPopup`, popup whitelist form, settings toggles, `normalizeUsername` | `popup/popup.test.ts` | PU-01..13 |

## Adversarial cases & pinned bugs

These tests deliberately probe edge cases. Several **pin current buggy behavior**
so a future fix flips the assertion (search `BUG XB-BUG`):

- **XB-BUG-02** (BT-03): whitelist matching is case-sensitive; `Safe_User` is
  blocked even though `safe_user` is whitelisted.
- **XB-BUG-03** (WL-11): content-script `addToWhitelist` stores raw (`@frank`)
  without normalizing, so the entry can never match an extracted handle.
- **XB-BUG-04** (BULK-03): `blockFirst20CommentTweets` actually caps at 50.
- **XB-BUG-05** (PU-11): popup remove filters all identical handles at once.
- **XB-BUG-07** (URL-04): tweet-URL regex is unanchored.
- **XB-BUG-08** (WL-12): concurrent `addToWhitelist` calls race and drop entries.

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
