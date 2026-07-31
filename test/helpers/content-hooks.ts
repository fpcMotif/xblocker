// Loads the content script once in test mode and exposes its internals.
// Every content.ts test file must obtain hooks through this module so the
// __XB_TEST__ flag is guaranteed to be set before the first import.

globalThis.__XB_TEST__ = true;
await import("../../entrypoints/content/index.ts");
globalThis.__XB_TEST__ = undefined;

const installed = globalThis.__xblockerTestHooks;
if (!installed) {
  throw new Error("content/index.ts did not install __xblockerTestHooks in test mode");
}

export const hooks = installed;

/** Build a tweet <article> with an author link and a mocked More button. */
export function createTweetArticle(username: string): {
  moreButton: HTMLElement & { clicks: number };
  tweetArticle: HTMLElement;
} {
  const tweetArticle = document.createElement("article");
  tweetArticle.setAttribute("data-testid", "tweet");

  const userLink = document.createElement("a");
  userLink.setAttribute("href", `/${username}/status/123456789`);
  userLink.setAttribute("role", "link");
  tweetArticle.appendChild(userLink);

  const moreButton = Object.assign(document.createElement("button"), { clicks: 0 });
  moreButton.setAttribute("aria-label", "More");
  moreButton.click = () => {
    moreButton.clicks++;
  };
  tweetArticle.appendChild(moreButton);

  return { moreButton, tweetArticle };
}

/** Build a tweet <article> that has no author link at all. */
export function createAnonymousTweetArticle(): HTMLElement {
  const tweetArticle = document.createElement("article");
  tweetArticle.setAttribute("data-testid", "tweet");
  return tweetArticle;
}

function tweetArticleElement(): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  return article;
}

function roleLink(handle: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.setAttribute("href", `/${handle}`);
  link.setAttribute("role", "link");
  return link;
}

// X's author byline (`[data-testid="User-Name"]`) renders a display-name link, a
// handle link, and a timestamp/permalink link, all pointing at the author — the
// shape verified against the live x.com DOM.
function authorByline(handle: string): HTMLElement {
  const block = document.createElement("div");
  block.setAttribute("data-testid", "User-Name");
  for (const href of [`/${handle}`, `/${handle}`, `/${handle}/status/123456789`]) {
    const link = document.createElement("a");
    link.setAttribute("href", href);
    link.setAttribute("role", "link");
    block.appendChild(link);
  }
  return block;
}

/**
 * Build a repost: an X "reposted" social-context link to `reposter` placed
 * *before* the original `author`'s byline. The reposter must never be resolved
 * as the author.
 */
export function createRepostArticle(opts: { reposter: string; author: string }): HTMLElement {
  const article = tweetArticleElement();
  const social = document.createElement("div");
  social.setAttribute("data-testid", "socialContext");
  social.appendChild(roleLink(opts.reposter));
  article.append(social, authorByline(opts.author));
  return article;
}

/**
 * Build a quote tweet: the outer `author`'s byline, a body `@mention`, and a
 * nested quoted tweet authored by `quoted` (wrapped in X's clickable quote
 * container). Only the outer author is the actor.
 */
export function createQuoteTweetArticle(opts: {
  author: string;
  quoted: string;
  mention: string;
}): HTMLElement {
  const article = tweetArticleElement();

  const body = document.createElement("div");
  body.setAttribute("data-testid", "tweetText");
  body.appendChild(roleLink(opts.mention));

  const quote = document.createElement("div");
  quote.setAttribute("role", "link");
  quote.setAttribute("tabindex", "0");
  quote.appendChild(authorByline(opts.quoted));

  article.append(authorByline(opts.author), body, quote);
  return article;
}

/**
 * Build a reply: a "Replying to @repliedTo" link placed *before* the `author`'s
 * byline, mirroring layouts where the reply context precedes the author link.
 */
export function createReplyArticle(opts: { repliedTo: string; author: string }): HTMLElement {
  const article = tweetArticleElement();
  const replyingTo = document.createElement("div");
  replyingTo.appendChild(roleLink(opts.repliedTo));
  article.append(replyingTo, authorByline(opts.author));
  return article;
}

/** Append `count` comment articles (plus one leading main-tweet article). */
export function populateTweetPage(usernames: string[]): HTMLElement[] {
  const main = createTweetArticle("thread_author").tweetArticle;
  document.body.appendChild(main);

  return usernames.map((username) => {
    const { tweetArticle } = createTweetArticle(username);
    document.body.appendChild(tweetArticle);
    return tweetArticle;
  });
}

/**
 * Append a "Discover more" heading followed by `usernames.length` recommended
 * articles, mirroring X's recommendation module beneath the genuine replies.
 * `headingText` defaults to the English heading; pass a localized string (e.g.
 * the zh-Hant "探索更多") to exercise the boundary on a non-English UI.
 * Returns the recommended articles (which are NOT replies to the conversation).
 */
export function appendDiscoverMoreSection(
  usernames: string[],
  headingText = "Discover more",
): HTMLElement[] {
  const heading = document.createElement("h2");
  heading.setAttribute("role", "heading");
  heading.textContent = headingText;
  document.body.appendChild(heading);

  return usernames.map((username) => {
    const { tweetArticle } = createTweetArticle(username);
    document.body.appendChild(tweetArticle);
    return tweetArticle;
  });
}

export type FetchCall = { url: string; init: RequestInit | undefined };

// Since ADR-0004 a confirmed bulk account makes two direct-API calls per attempt: the
// action POST (blocks/create.json or mutes/users/create.json) and this relationship-
// lookup GET that confirms it. Exported so every test file that needs to tell the two
// apart (bulk-actions.test.ts, rail-actions.test.ts, max-replies.test.ts) shares one
// definition instead of redeclaring the literal.
export const RELATIONSHIP_LOOKUP_PATH = "/1.1/friendships/show.json";

/** The action (create) calls only, in call order -- confirm calls filtered out. */
export function actionCalls(calls: readonly FetchCall[]): FetchCall[] {
  return calls.filter((call) => !call.url.includes(RELATIONSHIP_LOOKUP_PATH));
}

/** The relationship-lookup (confirm) calls only, in call order. */
export function confirmCalls(calls: readonly FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url.includes(RELATIONSHIP_LOOKUP_PATH));
}

/** A POST call's `screen_name=...` body, or throws -- for asserting the exact
 *  sequence of accounts a batch acted on. Relationship-lookup GETs have no body;
 *  filter through `actionCalls` first. */
export function requestBodyText(call: { init: RequestInit | undefined }): string {
  const body = call.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string");
  }
  return body;
}

/** `fetch`'s first argument, resolved to a plain URL string -- shared by every fetch
 *  stub/override in this file and in tests that install their own raw fetch. */
export function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** The target screen_name a direct-API call addresses, whether it's an action POST
 *  body (`screen_name=...`) or a relationship-lookup GET query (`target_screen_name=...`). */
function targetUsernameFromCall(url: string, init: RequestInit | undefined): string | undefined {
  if (typeof init?.body === "string") {
    return new URLSearchParams(init.body).get("screen_name") ?? undefined;
  }
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) {
    return undefined;
  }
  return new URLSearchParams(url.slice(queryIndex + 1)).get("target_screen_name") ?? undefined;
}

/**
 * Install a fetch stub; returns the recorded calls. `responder` decides ok/status for
 * every call the direct-API layer makes -- action POSTs (blocks/mutes create.json) AND
 * relationship-lookup GETs (friendships/show.json) alike -- and is handed the resolved
 * target username as a third argument so a test can key off it without parsing the
 * POST body vs GET query itself.
 *
 * A relationship-lookup call's JSON body is synthesized from that SAME decision: a
 * responder that says "ok" for a user is also reported as blocking/muting them, and one
 * that fails a user is reported as not (yet) confirmed. This mirrors the ground truth
 * the bulk runner's confirm step (ADR-0004) now requires, so a test whose responder
 * only decides success/failure per user -- most of them -- gets confirm-consistent
 * behavior for free without knowing the lookup endpoint exists. Tests that need act and
 * confirm to disagree (retry/backoff/rate-limit scenarios) install their own fetch
 * directly, the same way BULK-15/16 already do.
 */
export function installFetchStub(
  responder: (
    url: string,
    init: RequestInit | undefined,
    target: string | undefined,
  ) => { ok: boolean; status: number },
): { calls: FetchCall[]; uninstall: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  const globals = globalThis as Record<string, unknown>;

  globals["fetch"] = async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    const target = targetUsernameFromCall(url, init);
    const response = responder(url, init, target);
    calls.push({ url, init });
    const body = url.includes(RELATIONSHIP_LOOKUP_PATH)
      ? JSON.stringify({ relationship: { source: { blocking: response.ok, muting: response.ok } } })
      : null;
    return new Response(body, { status: response.status });
  };

  return {
    calls,
    uninstall() {
      globals["fetch"] = original;
    },
  };
}

/** Install a fetch stub that rejects with a network error. */
export function installRejectingFetch(message = "network down"): {
  calls: FetchCall[];
  uninstall: () => void;
} {
  const calls: FetchCall[] = [];
  const raw = installRawFetch(async (input, init) => {
    calls.push({ url: urlOf(input), init });
    throw new Error(message);
  });

  return { calls, uninstall: raw.restore };
}

export type RawFetchHandler = (
  input: string | URL | Request,
  init: RequestInit | undefined,
) => Promise<Response> | Response;

/**
 * Install an arbitrary raw fetch override, for scenarios `installFetchStub`'s
 * ok/fail-mirrored confirm body can't express -- the act and confirm calls need to
 * disagree (a flaky account that succeeds on a later attempt, a rate-limited action
 * with a still-unconfirmed lookup, an already-confirmed account whose action call
 * keeps failing). `handler` sees fetch's raw arguments and decides the Response itself
 * (typically branching on `url.includes(RELATIONSHIP_LOOKUP_PATH)`); `urlOf` resolves
 * its `input` to a plain string. Returns `restore()` to call in a `finally`.
 */
export function installRawFetch(handler: RawFetchHandler): { restore: () => void } {
  const original = globalThis.fetch;
  const globals = globalThis as Record<string, unknown>;
  globals["fetch"] = handler;
  return {
    restore() {
      globals["fetch"] = original;
    },
  };
}
