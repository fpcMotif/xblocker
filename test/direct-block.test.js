import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

globalThis.__XB_TEST__ = true;
await import("../entrypoints/content.ts");
delete globalThis.__XB_TEST__;

const hooks = globalThis.__xblockerTestHooks;

function setCookieString(value) {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => value,
    set: () => {},
  });
}

function createTweetArticle(username) {
  const tweetArticle = document.createElement("article");
  tweetArticle.setAttribute("data-testid", "tweet");

  const userLink = document.createElement("a");
  userLink.setAttribute("href", `/${username}/status/123456789`);
  userLink.setAttribute("role", "link");
  tweetArticle.appendChild(userLink);

  const moreButton = document.createElement("button");
  moreButton.setAttribute("aria-label", "More");
  moreButton.click = mock(() => {});
  tweetArticle.appendChild(moreButton);

  return { moreButton, tweetArticle };
}

describe("Direct block flow", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    setCookieString("ct0=csrf-token; auth_token=session-token");

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "x.com",
        href: "https://x.com/example/status/123456789",
      },
      writable: true,
    });

    global.fetch = mock(async () => ({
      ok: true,
      status: 200,
    }));

    global.chrome.storage.local.get = mock((keys, callback) => {
      callback({ whitelist: [] });
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    delete global.fetch;
  });

  test("creates a session-authenticated direct block request by screen name", () => {
    const request = hooks.createDirectBlockRequest("@test_user");

    expect(request.url).toBe("https://api.x.com/1.1/blocks/create.json");
    expect(request.options.method).toBe("POST");
    expect(request.options.credentials).toBe("include");
    expect(request.options.headers["X-Csrf-Token"]).toBe("csrf-token");
    expect(request.options.headers["X-Twitter-Auth-Type"]).toBe("OAuth2Session");
    expect(request.options.body).toBe("screen_name=test_user");
  });

  test("extracts the author username from status links and skips reserved X paths", () => {
    const tweetArticle = document.createElement("article");
    const reservedLink = document.createElement("a");
    reservedLink.setAttribute("href", "/i/status/123");
    reservedLink.setAttribute("role", "link");
    tweetArticle.appendChild(reservedLink);

    const userLink = document.createElement("a");
    userLink.setAttribute("href", "/real_user/status/123");
    userLink.setAttribute("role", "link");
    tweetArticle.appendChild(userLink);

    expect(hooks.extractUsernameFromTweet(tweetArticle)).toBe("real_user");
  });

  test("blocks directly without clicking the X More menu or confirmation modal", async () => {
    const { moreButton, tweetArticle } = createTweetArticle("direct_user");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result).toEqual({ status: "blocked", username: "direct_user" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.x.com/1.1/blocks/create.json");
    expect(global.fetch.mock.calls[0][1].body).toBe("screen_name=direct_user");
    expect(moreButton.click.mock.calls).toHaveLength(0);
    expect(document.querySelector('[data-testid="confirmationSheetConfirm"]')).toBeNull();
  });

  test("skips direct block requests for whitelisted users", async () => {
    global.chrome.storage.local.get = mock((keys, callback) => {
      callback({ whitelist: ["safe_user"] });
    });
    const { moreButton, tweetArticle } = createTweetArticle("safe_user");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result).toEqual({ status: "skipped", username: "safe_user" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(moreButton.click.mock.calls).toHaveLength(0);
  });

  test("fails early when the X csrf cookie is unavailable", () => {
    setCookieString("");

    expect(() => hooks.createDirectBlockRequest("test_user")).toThrow("Missing X CSRF token");
  });
});
