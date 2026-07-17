// Author extraction and the Discover-more reply-region boundary share tweet DOM rules.
import { normalizeUsername } from "../lib/settings";

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

/** The genuine reply articles of the conversation (main tweet and Discover-more
 *  recommendations excluded). Exported so per-scan consumers (Cursor Console
 *  injection) compute the set once instead of re-scanning per article. */
export function getConversationReplies(): Element[] {
  const boundary = findDiscoverMoreBoundary();
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  return articles.slice(1).filter((article) => isBeforeDiscoverMore(article, boundary));
}

// The rail badge counts the same genuine replies the batch acts on, so it must
// honor the Discover-more boundary rather than counting every tweet article.
export function countConversationReplies(): number {
  return getConversationReplies().length;
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
