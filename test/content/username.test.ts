// Catalog: UN-* (normalizeUsername) and EX-* (extractUsernameFromTweet).
import { beforeEach, describe, expect, test } from "bun:test";

import { hooks } from "../helpers/content-hooks.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("normalizeUsername", () => {
  test("UN-01 accepts a plain valid handle", () => {
    expect(hooks.normalizeUsername("valid_user")).toBe("valid_user");
  });

  test("UN-02 strips a single leading @", () => {
    expect(hooks.normalizeUsername("@valid_user")).toBe("valid_user");
  });

  test("UN-03 rejects a double @@ (only the first @ is stripped)", () => {
    expect(hooks.normalizeUsername("@@valid_user")).toBeNull();
  });

  test("UN-04 trims surrounding whitespace", () => {
    expect(hooks.normalizeUsername("  spaced_user  ")).toBe("spaced_user");
  });

  test("UN-05 rejects internal whitespace", () => {
    expect(hooks.normalizeUsername("two words")).toBeNull();
  });

  test("UN-06 accepts the 1-character lower bound", () => {
    expect(hooks.normalizeUsername("a")).toBe("a");
  });

  test("UN-07 accepts the 15-character upper bound", () => {
    expect(hooks.normalizeUsername("a".repeat(15))).toBe("a".repeat(15));
  });

  test("UN-08 rejects 16 characters (off-by-one guard)", () => {
    expect(hooks.normalizeUsername("a".repeat(16))).toBeNull();
  });

  test("UN-09 rejects null, undefined, and empty string", () => {
    expect(hooks.normalizeUsername(null)).toBeNull();
    expect(hooks.normalizeUsername(undefined)).toBeNull();
    expect(hooks.normalizeUsername("")).toBeNull();
  });

  test("UN-10 rejects a bare @ and whitespace-only input", () => {
    expect(hooks.normalizeUsername("@")).toBeNull();
    expect(hooks.normalizeUsername("   ")).toBeNull();
  });

  test("UN-11 rejects every reserved X path", () => {
    const reserved = [
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
      expect(hooks.normalizeUsername(path)).toBeNull();
    }
  });

  test("UN-12 reserved-path check is case-insensitive", () => {
    expect(hooks.normalizeUsername("HOME")).toBeNull();
    expect(hooks.normalizeUsername("Settings")).toBeNull();
    expect(hooks.normalizeUsername("@NOTIFICATIONS")).toBeNull();
  });

  test("UN-13 rejects hyphens, dots, slashes, and unicode", () => {
    expect(hooks.normalizeUsername("user-name")).toBeNull();
    expect(hooks.normalizeUsername("user.name")).toBeNull();
    expect(hooks.normalizeUsername("user/name")).toBeNull();
    expect(hooks.normalizeUsername("üser")).toBeNull();
    expect(hooks.normalizeUsername("用户")).toBeNull();
    expect(hooks.normalizeUsername("user😀")).toBeNull();
  });

  test("UN-14 rejects injection-shaped input", () => {
    expect(hooks.normalizeUsername("<script>")).toBeNull();
    expect(hooks.normalizeUsername("a&b=c")).toBeNull();
    expect(hooks.normalizeUsername("screen_name=admin&x")).toBeNull();
  });

  test("UN-15 accepts digits and underscores mixed", () => {
    expect(hooks.normalizeUsername("user_123")).toBe("user_123");
    expect(hooks.normalizeUsername("___")).toBe("___");
    expect(hooks.normalizeUsername("0")).toBe("0");
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
    expect(hooks.extractUsernameFromTweet(article)).toBe("real_user");
  });

  test("EX-02 skips reserved paths and falls through to the next link", () => {
    const article = articleWithLinks(["/i/status/123", "/real_user/status/123"]);
    expect(hooks.extractUsernameFromTweet(article)).toBe("real_user");
  });

  test("EX-03 returns null when no links exist", () => {
    const article = document.createElement("article");
    expect(hooks.extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-04 returns null when every link is reserved or invalid", () => {
    const article = articleWithLinks(["/home", "/search?q=x", "/not-a-valid-handle!"]);
    expect(hooks.extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-05 ignores the query string when parsing the path", () => {
    const article = articleWithLinks(["/query_user?ref_src=twsrc"]);
    expect(hooks.extractUsernameFromTweet(article)).toBe("query_user");
  });

  test("EX-06 ignores anchors without role=link", () => {
    const article = articleWithLinks(["/role_user/status/1"], "button");
    expect(hooks.extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-07 ignores absolute/external hrefs (selector requires a leading /)", () => {
    const article = document.createElement("article");
    const external = document.createElement("a");
    external.setAttribute("href", "https://evil.example/phish");
    external.setAttribute("role", "link");
    article.appendChild(external);
    expect(hooks.extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-08 handles a bare '/' href without crashing", () => {
    const article = articleWithLinks(["/"]);
    expect(hooks.extractUsernameFromTweet(article)).toBeNull();
  });

  test("EX-09 uses the first path segment only (photo/media links)", () => {
    const article = articleWithLinks(["/media_user/photo/1"]);
    expect(hooks.extractUsernameFromTweet(article)).toBe("media_user");
  });

  test("EX-10 first matching link wins over later links", () => {
    const article = articleWithLinks(["/first_user/status/1", "/second_user/status/2"]);
    expect(hooks.extractUsernameFromTweet(article)).toBe("first_user");
  });
});
