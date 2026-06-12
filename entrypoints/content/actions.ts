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
export const DEFAULT_MAX_REPLIES = 50;
export const MAX_REPLIES_LIMIT = 200;
const DIRECT_ACTION_ENDPOINTS: Record<DirectActionType, string> = {
  block: "/1.1/blocks/create.json",
  mute: "/1.1/mutes/users/create.json",
};
const TWEET_PAGE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
const LOCAL_TEST_PAGE_PATTERN = new RegExp(String.raw`^https?://(localhost|127\.0\.0\.1)`);
const RESERVED_X_PATHS = new Set<string>([
  "explore",
  "home",
  "i",
  "intent",
  "messages",
  "notifications",
  "search",
  "settings",
  "share",
]);

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

export function normalizeUsername(value: string | null | undefined): string | null {
  const username = value?.replace(/^@/, "").trim();
  if (!username || RESERVED_X_PATHS.has(username.toLowerCase())) {
    return null;
  }

  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : null;
}

export function extractUsernameFromTweet(tweetArticle: Element): string | null {
  const links = tweetArticle.querySelectorAll('a[href^="/"][role="link"]');
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
      const raw = readMaxRepliesSetting(result?.settings);
      const parsed =
        typeof raw === "number"
          ? Math.trunc(raw)
          : typeof raw === "string"
            ? Number.parseInt(raw, 10)
            : Number.NaN;
      if (!Number.isFinite(parsed)) {
        resolve(DEFAULT_MAX_REPLIES);
        return;
      }
      resolve(Math.min(MAX_REPLIES_LIMIT, Math.max(1, parsed)));
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

  try {
    await performDirectAction(type, username);
    return { status: type === "block" ? "blocked" : "muted", username };
  } catch (error) {
    console.warn(`Direct ${type} failed for @${username}:`, error);
    return { status: "failed", username, error };
  }
}

export function blockTweet(tweetArticle: Element): Promise<ReplyActionResult> {
  return actOnTweet("block", tweetArticle);
}

export function muteTweet(tweetArticle: Element): Promise<ReplyActionResult> {
  return actOnTweet("mute", tweetArticle);
}

async function getReplyArticles(): Promise<Element[]> {
  const maxReplies = await getMaxReplies();
  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
  return Array.from(tweetArticles).slice(1).slice(0, maxReplies);
}

export function isReplyArticle(article: Element): boolean {
  if (!article.matches('article[data-testid="tweet"]')) {
    return false;
  }
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  return articles.length > 0 && articles[0] !== article;
}

async function runReplyBatch(
  type: DirectActionType,
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchSummary | null> {
  if (!isTweetPageUrl(window.location.href)) {
    console.log("Not on a tweet page. Exiting.");
    return null;
  }

  const replies = await getReplyArticles();
  const summary: BatchSummary = { acted: 0, skipped: 0, failed: 0 };

  batchState.running = true;
  try {
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
  } finally {
    batchState.running = false;
  }

  console.log(
    `Finished direct ${type}. acted=${summary.acted}, skipped=${summary.skipped}, failed=${summary.failed}`,
  );
  return summary;
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
