import { blockedStore } from "../lib/blocked-store";
import {
  clampMaxReplies,
  normalizeUsername,
  DEFAULT_MAX_REPLIES,
  MAX_REPLIES_LIMIT,
} from "../lib/settings";

// Re-exported so existing importers (modal.ts, index.ts hooks, tests) keep their
// `from "./actions"` path while the single definition lives in ../lib/settings.
export { normalizeUsername, DEFAULT_MAX_REPLIES, MAX_REPLIES_LIMIT };

export type DirectActionType = "block" | "mute";

export type ReplyActionResult =
  | { status: "blocked" | "muted" | "skipped"; username: string }
  | { status: "failed"; username?: string; reason?: string; error?: unknown };

export type DirectActionRequest = {
  url: string;
  options: RequestInit & {
    method: "POST";
    credentials: "include";
    headers: Record<string, string>;
    body: string;
  };
};

export type BatchProgress = { done: number; total: number };
export type BatchSummary = { acted: number; skipped: number; failed: number };

const X_AUTH_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const DIRECT_ACTION_DELAY_MS = 250;
const DIRECT_ACTION_ENDPOINTS: Record<DirectActionType, string> = {
  block: "/1.1/blocks/create.json",
  mute: "/1.1/mutes/users/create.json",
};
const TWEET_PAGE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
const LOCAL_TEST_PAGE_PATTERN = new RegExp(String.raw`^https?://(localhost|127\.0\.0\.1)`);

export const batchState = { running: false };

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getCookieValue(name: string): string {
  return (
    document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}

export function isTweetPageUrl(url: string): boolean {
  const isLocalTestPage =
    typeof globalThis !== "undefined" &&
    globalThis.__XB_TEST__ &&
    LOCAL_TEST_PAGE_PATTERN.test(url);

  return TWEET_PAGE_URL_PATTERN.test(url) || !!isLocalTestPage;
}

// One reply <article> holds several handle-shaped links, so the old "first
// /handle link wins" scan mis-attributes the author: a "<x> reposted"
// social-context link, a "Replying to @x" link, an @mention in the body, and a
// quoted tweet's own author link can all sit before or beside the real author.
// Acting on the wrong handle silently blocks the wrong person (the bulk reply
// rail and the per-reply Cursor Console both act with no confirmation), so the
// author is resolved from the outer User-Name byline and, only when that is
// absent, from the article's links with the body text and any quoted tweet
// excluded.
//
// Selectors confirmed against a live (zh-Hant) x.com DOM: the author byline is
// `[data-testid="User-Name"]` (its anchors point at `/handle` and
// `/handle/status/...`), the body is `[data-testid="tweetText"]`, and a quoted
// tweet is a clickable `div[role="link"][tabindex]`. The outer byline always
// precedes a quoted tweet's nested byline in document order, so the first one
// names the author.
const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
const QUOTE_CONTAINER_SELECTOR = 'div[role="link"][tabindex]';
const SOCIAL_CONTEXT_SELECTOR = '[data-testid="socialContext"]';
const NESTED_REGION_SELECTOR = `${TWEET_TEXT_SELECTOR}, ${QUOTE_CONTAINER_SELECTOR}`;
// The byline always wins when present, so the social-context handle is only a
// hazard in the no-byline fallback scan: exclude it there on top of the nested
// regions so a "<x> reposted" link cannot be mistaken for the author.
const FALLBACK_EXCLUDED_REGION_SELECTOR = `${NESTED_REGION_SELECTOR}, ${SOCIAL_CONTEXT_SELECTOR}`;

// True when `element` belongs to the body text or a nested quoted tweet of
// `article`. The `article.contains` guard stops a role="link" wrapper *around*
// the whole article (some embed surfaces) from excluding a genuine author link.
function isInsideNestedRegion(element: Element, article: Element): boolean {
  const region = element.closest(NESTED_REGION_SELECTOR);
  return region !== null && article.contains(region);
}

// Fallback-only variant: also treats the repost social-context region as nested
// so its reposter handle is skipped when no byline names the author.
function isInsideFallbackExcludedRegion(element: Element, article: Element): boolean {
  const region = element.closest(FALLBACK_EXCLUDED_REGION_SELECTOR);
  return region !== null && article.contains(region);
}

function firstAuthorHandle(links: Iterable<Element>): string | null {
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const firstPathPart = href.split("?")[0]?.split("/").find(Boolean) || "";
    const username = normalizeUsername(firstPathPart);
    if (username) {
      return username;
    }
  }
  return null;
}

// The author's own timestamp permalink (/handle/status/...). A "Replying to @x"
// reply-target link is a bare /handle profile link X renders in a plain <div>
// we cannot region-exclude, so in the no-byline fallback a permalink is the one
// shape we can trust over a leading context handle.
function isStatusPermalink(link: Element): boolean {
  const path = (link.getAttribute("href") || "").split("?")[0] ?? "";
  return /^\/[^/]+\/status\//.test(path);
}

export function extractUsernameFromTweet(tweetArticle: Element): string | null {
  // The author's byline — but never a quoted tweet's nested byline.
  const byline = tweetArticle.querySelector('[data-testid="User-Name"]');
  if (byline && !isInsideNestedRegion(byline, tweetArticle)) {
    const author = firstAuthorHandle(byline.querySelectorAll('a[href^="/"]'));
    if (author) {
      return author;
    }
  }

  // No usable byline (older markup or a locale variant): scan the article's
  // links with the body text, quoted tweet, and repost social-context excluded.
  // A "Replying to @x" link is a plain <div> we cannot region-exclude, so prefer
  // the author's own status permalink and only fall back to the first bare handle
  // (a profile or media link) when no permalink is present.
  const candidates = Array.from(tweetArticle.querySelectorAll('a[href^="/"][role="link"]')).filter(
    (link) => !isInsideFallbackExcludedRegion(link, tweetArticle),
  );

  return firstAuthorHandle(candidates.filter(isStatusPermalink)) ?? firstAuthorHandle(candidates);
}

function getXApiBaseUrl(): string {
  return window.location.hostname === "twitter.com"
    ? "https://api.twitter.com"
    : "https://api.x.com";
}

function createDirectActionRequest(type: DirectActionType, username: string): DirectActionRequest {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error(`Missing valid username for direct ${type}.`);
  }

  const csrfToken = getCookieValue("ct0");
  if (!csrfToken) {
    throw new Error("Missing X CSRF token; open x.com while signed in and try again.");
  }

  return {
    url: `${getXApiBaseUrl()}${DIRECT_ACTION_ENDPOINTS[type]}`,
    options: {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${X_AUTH_BEARER_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Csrf-Token": csrfToken,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
      },
      body: new URLSearchParams({ screen_name: normalizedUsername }).toString(),
    },
  };
}

export function createDirectBlockRequest(username: string): DirectActionRequest {
  return createDirectActionRequest("block", username);
}

export function createDirectMuteRequest(username: string): DirectActionRequest {
  return createDirectActionRequest("mute", username);
}

async function performDirectAction(type: DirectActionType, username: string): Promise<Response> {
  const request = createDirectActionRequest(type, username);
  const response = await fetch(request.url, request.options);
  if (!response.ok) {
    throw new Error(`Direct ${type} failed with HTTP ${response.status}.`);
  }
  return response;
}

type DirectBlockOutcome = { screen_name: string; id_str?: string };

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readProp(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}

// blocks/create.json returns the blocked user object, including the stable numeric
// id_str. Capture it so the local store keys on the id rather than the mutable screen
// name. Fall back to the screen name if the body is missing or unreadable.
async function readBlockOutcome(response: Response, username: string): Promise<DirectBlockOutcome> {
  let screenName = normalizeUsername(username) ?? username;
  let idStr: string | undefined;
  try {
    const body = safeParseJson(await response.text());
    const idStrValue = readProp(body, "id_str");
    const idValue = readProp(body, "id");
    const screenNameValue = readProp(body, "screen_name");
    if (typeof idStrValue === "string") {
      idStr = idStrValue;
    } else if (typeof idValue === "number") {
      idStr = String(idValue);
    }
    if (typeof screenNameValue === "string") {
      screenName = screenNameValue;
    }
  } catch (error) {
    console.warn("Could not read block response body; falling back to screen name.", error);
  }

  return { screen_name: screenName, ...(idStr ? { id_str: idStr } : {}) };
}

export function blockUserDirectly(username: string): Promise<Response> {
  return performDirectAction("block", username);
}

export function muteUserDirectly(username: string): Promise<Response> {
  return performDirectAction("mute", username);
}

export type WhitelistAddResult = "added" | "error" | "exists" | "invalid";

type WhitelistRead = { ok: boolean; whitelist: string[] };

function readWhitelist(): Promise<WhitelistRead> {
  return new Promise((resolve) => {
    chrome.storage.local.get("whitelist", (result) => {
      if (result === undefined) {
        resolve({ ok: false, whitelist: [] });
        return;
      }
      resolve({ ok: true, whitelist: Array.isArray(result.whitelist) ? result.whitelist : [] });
    });
  });
}

export function getWhitelist(): Promise<string[]> {
  return readWhitelist().then((read) => read.whitelist);
}

function saveWhitelist(whitelist: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ whitelist: whitelist }, () => {
      resolve();
    });
  });
}

// X handles are case-insensitive.
function matchesHandle(entry: string, username: string): boolean {
  return entry.toLowerCase() === username.toLowerCase();
}

export async function isWhitelisted(username: string): Promise<boolean> {
  const whitelist = await getWhitelist();
  return whitelist.some((entry) => matchesHandle(entry, username));
}

// chrome.storage has no transactions, so whitelist read-modify-writes are
// serialized through this chain; concurrent mutations queue instead of racing.
let whitelistMutationChain: Promise<unknown> = Promise.resolve();

function enqueueWhitelistMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const run = whitelistMutationChain.then(mutate);
  whitelistMutationChain = run;
  return run;
}

export function addToWhitelist(username: string): Promise<WhitelistAddResult> {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return Promise.resolve("invalid");
  }
  return enqueueWhitelistMutation(async () => {
    const read = await readWhitelist();
    // A failed read looks like an empty list; saving would clobber the
    // stored whitelist, so abort instead.
    if (!read.ok) {
      return "error";
    }
    if (read.whitelist.some((entry) => matchesHandle(entry, normalized))) {
      return "exists";
    }
    await saveWhitelist([...read.whitelist, normalized]);
    return "added";
  });
}

export function removeFromWhitelist(username: string): Promise<void> {
  return enqueueWhitelistMutation(async () => {
    const read = await readWhitelist();
    if (!read.ok) {
      return;
    }
    await saveWhitelist(read.whitelist.filter((entry) => !matchesHandle(entry, username)));
  });
}

function readMaxRepliesSetting(settings: unknown): unknown {
  if (typeof settings === "object" && settings !== null && "maxReplies" in settings) {
    return settings.maxReplies;
  }
  return undefined;
}

export function getMaxReplies(): Promise<number> {
  return new Promise((resolve) => {
    chrome.storage.local.get("settings", (result) => {
      resolve(clampMaxReplies(readMaxRepliesSetting(result?.settings)));
    });
  });
}

async function actOnTweet(
  type: DirectActionType,
  tweetArticle: Element,
): Promise<ReplyActionResult> {
  const username = extractUsernameFromTweet(tweetArticle);

  if (!username) {
    console.log("Username not found for a comment tweet.");
    return { status: "failed", reason: "missing-username" };
  }

  if (await isWhitelisted(username)) {
    console.log(`Skipping @${username}, as they are in the whitelist.`);
    return { status: "skipped", username };
  }

  let response: Response;
  try {
    response = await performDirectAction(type, username);
  } catch (error) {
    console.warn(`Direct ${type} failed for @${username}:`, error);
    return { status: "failed", username, error };
  }

  // The X action already succeeded — record it as a best-effort side-effect that can
  // never downgrade the result. The local store is the source of truth the optional
  // Convex backup drains; blocks carry the stable numeric id when X returns it, while
  // the mute endpoint gives us none, so mutes are recorded by screen name.
  await recordAction(type, response, username);
  return { status: type === "block" ? "blocked" : "muted", username };
}

async function recordAction(
  type: DirectActionType,
  response: Response,
  username: string,
): Promise<void> {
  try {
    if (type === "block") {
      const outcome = await readBlockOutcome(response, username);
      await blockedStore.record({
        handle: outcome.screen_name,
        kind: "block",
        source: "reply-bar",
        ...(outcome.id_str ? { xUserId: outcome.id_str } : {}),
      });
    } else {
      await blockedStore.record({ handle: username, kind: "mute", source: "reply-bar" });
    }
  } catch (error) {
    console.warn(`Recorded ${type} of @${username} to the local store failed:`, error);
  }
}

export function blockTweet(tweetArticle: Element): Promise<ReplyActionResult> {
  return actOnTweet("block", tweetArticle);
}

export function muteTweet(tweetArticle: Element): Promise<ReplyActionResult> {
  return actOnTweet("mute", tweetArticle);
}

// X appends a "Discover more" module of recommended posts beneath the genuine
// replies, reusing the same article markup. Those recommendations are not
// replies to this conversation, so bulk actions and reply-region detection stop
// at that boundary. The heading carries no stable testid, so it is matched by
// text against the locales this extension supports — English and the zh-Hant /
// zh-Hans UI the user actually runs (X renders "探索更多" in both Chinese scripts).
// An English-only match silently failed on a localized UI: the boundary was never
// found, so every recommended post counted as a reply and "Block all replies"
// blocked up to maxReplies strangers who never replied. On an unrecognized locale
// not in this set the boundary is still not found and detection falls back to the
// prior "every later article is a reply" behavior, so a genuine reply is never
// silently skipped (recommendations are over-included rather than a reply dropped).
const DISCOVER_MORE_HEADINGS = new Set<string>(["discover more", "探索更多"]);

function findDiscoverMoreBoundary(): Element | null {
  const headings = Array.from(document.querySelectorAll('h2, [role="heading"]'));
  return (
    headings.find((heading) =>
      DISCOVER_MORE_HEADINGS.has((heading.textContent ?? "").trim().toLowerCase()),
    ) ?? null
  );
}

// True when `node` precedes the Discover-more boundary in document order (or
// when no boundary exists). Degrades to true if compareDocumentPosition is
// unavailable, so a detection failure can never drop a reply from a batch.
function isBeforeDiscoverMore(node: Element, boundary: Element | null): boolean {
  if (!boundary || typeof node.compareDocumentPosition !== "function") {
    return true;
  }
  return (boundary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

function getConversationReplies(): Element[] {
  const boundary = findDiscoverMoreBoundary();
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  return articles.slice(1).filter((article) => isBeforeDiscoverMore(article, boundary));
}

// The rail badge counts the same genuine replies the batch acts on, so it must
// honor the Discover-more boundary rather than counting every tweet article.
export function countConversationReplies(): number {
  return getConversationReplies().length;
}

async function getReplyArticles(): Promise<Element[]> {
  const maxReplies = await getMaxReplies();
  return getConversationReplies().slice(0, maxReplies);
}

export function isReplyArticle(article: Element): boolean {
  if (!article.matches('article[data-testid="tweet"]')) {
    return false;
  }
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  if (articles.length === 0 || articles[0] === article) {
    return false;
  }
  return isBeforeDiscoverMore(article, findDiscoverMoreBoundary());
}

async function runReplyBatch(
  type: DirectActionType,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchSummary | null> {
  if (!isTweetPageUrl(window.location.href)) {
    console.log("Not on a tweet page. Exiting.");
    return null;
  }

  // A batch already in flight owns the page; a second concurrent invocation
  // (Block then Mute clicked quickly, or a double-fire) must not double-act.
  if (batchState.running) {
    console.log("A batch is already running.");
    return null;
  }

  // Claim the run synchronously, before the first await, so the re-entry window
  // is closed against a concurrent caller.
  batchState.running = true;
  try {
    const replies = await getReplyArticles();
    const summary: BatchSummary = { acted: 0, skipped: 0, failed: 0 };
    for (const [index, article] of replies.entries()) {
      const result = await actOnTweet(type, article);
      if (result.status === "blocked" || result.status === "muted") {
        summary.acted++;
        if (article instanceof HTMLElement) {
          article.dataset.xbBlocked = "true";
        }
      } else if (result.status === "skipped") {
        summary.skipped++;
      } else {
        summary.failed++;
      }
      onProgress?.({ done: index + 1, total: replies.length });
      await waitFor(DIRECT_ACTION_DELAY_MS);
    }
    console.log(
      `Finished direct ${type}. acted=${summary.acted}, skipped=${summary.skipped}, failed=${summary.failed}`,
    );
    return summary;
  } finally {
    batchState.running = false;
  }
}

export function blockReplies(
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchSummary | null> {
  return runReplyBatch("block", onProgress);
}

export function muteReplies(
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchSummary | null> {
  return runReplyBatch("mute", onProgress);
}
