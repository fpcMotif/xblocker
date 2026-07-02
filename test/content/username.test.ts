// Catalog: UN-* (normalizeUsername) and EX-* (extractUsernameFromTweet).
import { beforeEach, describe, expect, test } from "bun:test";

import { extractUsernameFromTweet, normalizeUsername } from "../../entrypoints/content/actions.ts";
import {
  createQuoteTweetArticle,
  createReplyArticle,
  createRepostArticle,
} from "../helpers/content-hooks.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("normalizeUsername", () => {
  test("UN-01 accepts a plain valid handle", () => {
    expect(normalizeUsername("valid_user")).toBe("valid_user");
  });

  test("UN-02 strips a single leading @", () => {
    expect(normalizeUsername("@valid_user")).toBe("valid_user");
  });

  test("UN-03 rejects a double @@ (only the first @ is stripped)", () => {
    expect(normalizeUsername("@@valid_user")).toBeNull();
  });

  test("UN-04 trims surrounding whitespace", () => {
    expect(normalizeUsername("  spaced_user  ")).toBe("spaced_user");
  });

  test("UN-05 rejects internal whitespace", () => {
    expect(normalizeUsername("two words")).toBeNull();
  });

  test("UN-06 accepts the 1-character lower bound", () => {
    expect(normalizeUsername("a")).toBe("a");
  });

  test("UN-07 accepts the 15-character upper bound", () => {
    expect(normalizeUsername("a".repeat(15))).toBe("a".repeat(15));
  });

  test("UN-08 rejects 16 characters (off-by-one guard)", () => {
    expect(normalizeUsername("a".repeat(16))).toBeNull();
  });

  test("UN-09 rejects null, undefined, and empty string", () => {
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
    expect(normalizeUsername("")).toBeNull();
  });

  test("UN-10 rejects a bare @ and whitespace-only input", () => {
    expect(normalizeUsername("@")).toBeNull();
    expect(normalizeUsername("   ")).toBeNull();
  });

  test("UN-11 rejects every reserved X path", () => {
    const reserved = [
      "explore",
      "home",
      "i",
      "intent",
      "messages",
      "notifications",
      "search",
      "settings",
      "share",
    ];
    for (const path of reserved) {
      expect(normalizeUsername(path)).toBeNull();
    }
  });

  test("UN-12 reserved-path check is case-insensitive", () => {
    expect(normalizeUsername("HOME")).toBeNull();
    expect(normalizeUsername("Settings")).toBeNull();
    expect(normalizeUsername("@NOTIFICATIONS")).toBeNull();
  });

  test("UN-13 rejects hyphens, dots, slashes, and unicode", () => {
    expect(normalizeUsername("user-name")).toBeNull();
    expect(normalizeUsername("user.name")).toBeNull();
    expect(normalizeUsername("user/name")).toBeNull();
    expect(normalizeUsername("üser")).toBeNull();
    expect(normalizeUsername("用户")).toBeNull();
    expect(normalizeUsername("user😀")).toBeNull();
  });

  test("UN-14 rejects injection-shaped input", () => {
    expect(normalizeUsername("<script>")).toBeNull();
    expect(normalizeUsername("a&b=c")).toBeNull();
    expect(normalizeUsername("screen_name=admin&x")).toBeNull();
  });

  test("UN-15 accepts digits and underscores mixed", () => {
    expect(normalizeUsername("user_123")).toBe("user_123");
    expect(normalizeUsername("___")).toBe("___");
    expect(normalizeUsername("0")).toBe("0");
  });

  test("UN-16 @ is stripped before trimming, so ' @user ' is rejected", () => {
    // replace(/^@/) runs on the raw value; a leading space hides the @ from it,
    // leaving "@user" after trim, which fails the handle regex.
    expect(normalizeUsername(" @leading_space ")).toBeNull();
  });
});

describe("extractUsernameFromTweet", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  function articleWithLinks(hrefs: string[], role = "link"): HTMLElement {
    const article = document.createElement("article");
    for (const href of hrefs) {
      const link = document.createElement("a");
      link.setAttribute("href", href);
      link.setAttribute("role", role);
      article.appendChild(link);
    }
    return article;
  }

  test("EX-01 extracts the handle from a status link", () => {
    const article = articleWithLinks(["/real_user/status/123"]);
    expect(extractUsernameFromTweet(article)).toBe("real_user");
  });

  test("EX-02 skips reserved paths and falls through to the next link", () => {
    const article = articleWithLinks(["/i/status/123", "/real_user/status/123"]);
    expect(extractUsernameFromTweet(article)).toBe("real_user");
  });

  test("EX-03 returns null when no links exist", () => {
    const article = document.createElement("article");
    expect(extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-04 returns null when every link is reserved or invalid", () => {
    const article = articleWithLinks(["/home", "/search?q=x", "/not-a-valid-handle!"]);
    expect(extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-05 ignores the query string when parsing the path", () => {
    const article = articleWithLinks(["/query_user?ref_src=twsrc"]);
    expect(extractUsernameFromTweet(article)).toBe("query_user");
  });

  test("EX-06 ignores anchors without role=link", () => {
    const article = articleWithLinks(["/role_user/status/1"], "button");
    expect(extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-07 ignores absolute/external hrefs (selector requires a leading /)", () => {
    const article = document.createElement("article");
    const external = document.createElement("a");
    external.setAttribute("href", "https://evil.example/phish");
    external.setAttribute("role", "link");
    article.appendChild(external);
    expect(extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-08 handles a bare '/' href without crashing", () => {
    const article = articleWithLinks(["/"]);
    expect(extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-09 uses the first path segment only (photo/media links)", () => {
    const article = articleWithLinks(["/media_user/photo/1"]);
    expect(extractUsernameFromTweet(article)).toBe("media_user");
  });

  test("EX-10 first matching link wins over later links", () => {
    const article = articleWithLinks(["/first_user/status/1", "/second_user/status/2"]);
    expect(extractUsernameFromTweet(article)).toBe("first_user");
  });

  // EX-11..EX-18 cover realistic X markup where a non-author handle link precedes
  // or sits beside the real author. A wrong result here silently blocks the wrong
  // person, so these pin the OUTER author against repost/quote/reply layouts.

  function tweetArticle(): HTMLElement {
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    return article;
  }

  function addRoleLink(parent: Element, href: string): void {
    const link = document.createElement("a");
    link.setAttribute("href", href);
    link.setAttribute("role", "link");
    parent.appendChild(link);
  }

  function addRegion(
    parent: Element,
    attrs: Record<string, string>,
    linkHref: string,
  ): HTMLElement {
    const region = document.createElement("div");
    for (const [name, value] of Object.entries(attrs)) {
      region.setAttribute(name, value);
    }
    addRoleLink(region, linkHref);
    parent.appendChild(region);
    return region;
  }

  test("EX-11 resolves the original author of a repost, never the reposter", () => {
    // The "<reposter> reposted" social-context link precedes the byline in DOM
    // order, so the old first-link-wins scan returned the reposter.
    const article = createRepostArticle({ reposter: "reposter_acct", author: "real_author" });
    expect(extractUsernameFromTweet(article)).toBe("real_author");
  });

  test("EX-12 resolves the outer author of a quote tweet, not the quoted account or a mention", () => {
    const article = createQuoteTweetArticle({
      author: "outer_author",
      quoted: "quoted_author",
      mention: "mentioned_acct",
    });
    expect(extractUsernameFromTweet(article)).toBe("outer_author");
  });

  test("EX-13 resolves the reply author, not the 'Replying to' target placed first", () => {
    const article = createReplyArticle({ repliedTo: "replied_to", author: "reply_author" });
    expect(extractUsernameFromTweet(article)).toBe("reply_author");
  });

  test("EX-14 (no byline) skips a body @mention and resolves a later author link", () => {
    const article = tweetArticle();
    addRegion(article, { "data-testid": "tweetText" }, "/mentioned_acct");
    addRoleLink(article, "/real_author/status/1");
    expect(extractUsernameFromTweet(article)).toBe("real_author");
  });

  test("EX-15 (no byline) skips a quoted tweet's author and resolves a later author link", () => {
    const article = tweetArticle();
    addRegion(article, { role: "link", tabindex: "0" }, "/quoted_author");
    addRoleLink(article, "/real_author/status/1");
    expect(extractUsernameFromTweet(article)).toBe("real_author");
  });

  test("EX-16 falls back to article links when the byline has no resolvable handle", () => {
    const article = tweetArticle();
    // A byline whose only link is a reserved path resolves nothing on its own.
    addRegion(article, { "data-testid": "User-Name" }, "/home");
    addRoleLink(article, "/fallback_author/status/1");
    expect(extractUsernameFromTweet(article)).toBe("fallback_author");
  });

  test("EX-17 keeps the author link when the whole article is wrapped in a role=link surface", () => {
    // Some embed surfaces wrap the article in a clickable div[role=link]; the
    // article.contains guard must not treat that ancestor as a nested region.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "link");
    wrapper.setAttribute("tabindex", "0");
    const article = tweetArticle();
    addRoleLink(article, "/wrapped_author/status/1");
    wrapper.appendChild(article);
    expect(extractUsernameFromTweet(article)).toBe("wrapped_author");
  });

  test("EX-18 returns null rather than blocking the quoted account when only its byline exists", () => {
    // Defensive: an article whose only User-Name block sits inside a quoted tweet
    // (the outer tweet's byline is missing) must resolve nobody, not the quoted
    // account.
    const article = tweetArticle();
    const quote = document.createElement("div");
    quote.setAttribute("role", "link");
    quote.setAttribute("tabindex", "0");
    const byline = document.createElement("div");
    byline.setAttribute("data-testid", "User-Name");
    addRoleLink(byline, "/quoted_author");
    quote.appendChild(byline);
    article.appendChild(quote);
    expect(extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-19 (no byline) skips a repost social-context handle and resolves the real author", () => {
    // With no byline to win, a "<x> reposted" social-context link placed before
    // the real author link must not be mistaken for the author.
    const article = tweetArticle();
    addRegion(article, { "data-testid": "socialContext" }, "/reposter_acct");
    addRoleLink(article, "/real_author/status/1");
    expect(extractUsernameFromTweet(article)).toBe("real_author");
  });

  test("EX-20 (no byline) skips a plain-div 'Replying to' target and resolves the author permalink", () => {
    // X renders the reply-context row as a plain <div> (no testid, not a quote
    // container), so it cannot be region-excluded; the author's status permalink
    // is preferred over the bare reply-target handle that precedes it. Without
    // the permalink preference the first-link scan returns "replied_to" and the
    // no-confirmation bulk/Console paths block the wrong person.
    const article = tweetArticle();
    addRegion(article, {}, "/replied_to");
    addRoleLink(article, "/reply_author/status/1");
    expect(extractUsernameFromTweet(article)).toBe("reply_author");
  });

  test("EX-21 (no byline) returns null rather than the reposter when no author link exists", () => {
    // A repost whose only handle is the social-context reposter must resolve
    // nobody — failing closed is correct; blocking the reposter is not.
    const article = tweetArticle();
    addRegion(article, { "data-testid": "socialContext" }, "/reposter_acct");
    expect(extractUsernameFromTweet(article)).toBeNull();
  });
});
