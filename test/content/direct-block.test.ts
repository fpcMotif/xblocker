// Catalog: DB-* (createDirectBlockRequest / blockUserDirectly) and BT-* (blockTweet).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createAnonymousTweetArticle,
  createTweetArticle,
  hooks,
  installFetchStub,
  installRejectingFetch,
} from "../helpers/content-hooks.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

describe("createDirectBlockRequest", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token; auth_token=session-token");
  });

  test("DB-01 builds the full session-authenticated request", () => {
    const request = hooks.createDirectBlockRequest("test_user");

    expect(request.url).toBe("https://api.x.com/1.1/blocks/create.json");
    expect(request.options.method).toBe("POST");
    expect(request.options.credentials).toBe("include");
    expect(request.options.headers["Authorization"]).toStartWith("Bearer ");
    expect(request.options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(request.options.headers["X-Csrf-Token"]).toBe("csrf-token");
    expect(request.options.headers["X-Twitter-Active-User"]).toBe("yes");
    expect(request.options.headers["X-Twitter-Auth-Type"]).toBe("OAuth2Session");
    expect(request.options.body).toBe("screen_name=test_user");
  });

  test("DB-02 normalizes an @-prefixed handle before sending", () => {
    const request = hooks.createDirectBlockRequest("@test_user");
    expect(request.options.body).toBe("screen_name=test_user");
  });

  test("DB-03 targets api.twitter.com when browsing twitter.com", () => {
    setWindowLocation("https://twitter.com/user/status/1");
    const request = hooks.createDirectBlockRequest("test_user");
    expect(request.url).toBe("https://api.twitter.com/1.1/blocks/create.json");
  });

  test("DB-04 throws on an invalid username before any cookie work", () => {
    expect(() => hooks.createDirectBlockRequest("not a handle")).toThrow("Missing valid username");
    expect(() => hooks.createDirectBlockRequest("")).toThrow("Missing valid username");
    expect(() => hooks.createDirectBlockRequest("home")).toThrow("Missing valid username");
  });

  test("DB-05 throws when the ct0 CSRF cookie is missing", () => {
    setDocumentCookie("auth_token=session-token");
    expect(() => hooks.createDirectBlockRequest("test_user")).toThrow("Missing X CSRF token");
  });

  test("DB-06 throws when ct0 exists but is empty", () => {
    setDocumentCookie("ct0=; auth_token=session-token");
    expect(() => hooks.createDirectBlockRequest("test_user")).toThrow("Missing X CSRF token");
  });
});

describe("blockUserDirectly", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
  });

  test("DB-07 performs exactly one POST and resolves on HTTP 200", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));

    const response = await hooks.blockUserDirectly("direct_user");

    expect(response.status).toBe(200);
    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0]!;
    expect(call.url).toBe("https://api.x.com/1.1/blocks/create.json");
    expect(call.init?.body).toBe("screen_name=direct_user");
  });

  test("DB-08 throws with the HTTP status on 401 (signed out)", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 401 }));
    await hooks.blockUserDirectly("direct_user").then(
      () => {
        throw new Error("Expected direct block to reject");
      },
      (error) => {
        expect(String(error)).toContain("HTTP 401");
      },
    );
  });

  test("DB-09 throws with the HTTP status on 429 (rate limited)", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 429 }));
    await hooks.blockUserDirectly("direct_user").then(
      () => {
        throw new Error("Expected direct block to reject");
      },
      (error) => {
        expect(String(error)).toContain("HTTP 429");
      },
    );
  });

  test("DB-10 propagates network-level fetch rejections", async () => {
    const rejecting = installRejectingFetch("connection reset");
    try {
      await hooks.blockUserDirectly("direct_user").then(
        () => {
          throw new Error("Expected direct block to reject");
        },
        (error) => {
          expect(String(error)).toContain("connection reset");
        },
      );
    } finally {
      rejecting.uninstall();
    }
  });

  test("DB-11 never calls fetch when request construction fails", async () => {
    setDocumentCookie("");
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    await hooks.blockUserDirectly("direct_user").then(
      () => {
        throw new Error("Expected direct block to reject");
      },
      (error) => {
        expect(String(error)).toContain("Missing X CSRF token");
      },
    );
    expect(fetchStub.calls).toHaveLength(0);
  });
});

describe("blockTweet", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
  });

  test("BT-01 blocks via the API without touching the X UI menus", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { moreButton, tweetArticle } = createTweetArticle("direct_user");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result).toEqual({ status: "blocked", username: "direct_user" });
    expect(fetchStub.calls).toHaveLength(1);
    expect(moreButton.clicks).toBe(0);
  });

  test("BT-02 skips whitelisted users without any network traffic", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { tweetArticle } = createTweetArticle("safe_user");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result).toEqual({ status: "skipped", username: "safe_user" });
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BT-03 BUG XB-BUG-02: whitelist matching is case-sensitive, so casing bypasses it", async () => {
    // X handles are case-insensitive; the whitelist compare is not. A user
    // whitelisted as "safe_user" is still blocked when the tweet link casing
    // differs. This pins the current (wrong) behavior — fixing it should
    // flip this expectation to "skipped".
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { tweetArticle } = createTweetArticle("Safe_User");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result).toEqual({ status: "blocked", username: "Safe_User" });
    expect(fetchStub.calls).toHaveLength(1);
  });

  test("BT-04 fails with missing-username when no author link exists", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));

    const result = await hooks.blockTweet(createAnonymousTweetArticle());

    expect(result).toEqual({ status: "failed", reason: "missing-username" });
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BT-05 fails (not throws) when the block API errors", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 403 }));
    const { tweetArticle } = createTweetArticle("api_blocked");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.username).toBe("api_blocked");
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  test("BT-06 fails when the CSRF cookie is missing (no fetch attempted)", async () => {
    setDocumentCookie("");
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { tweetArticle } = createTweetArticle("nocookie_user");

    const result = await hooks.blockTweet(tweetArticle);

    expect(result.status).toBe("failed");
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BT-07 consults storage on every call (no stale whitelist cache)", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { tweetArticle } = createTweetArticle("toggled_user");

    expect(await hooks.blockTweet(tweetArticle)).toEqual({
      status: "blocked",
      username: "toggled_user",
    });

    storageFake.data["whitelist"] = ["toggled_user"];
    expect(await hooks.blockTweet(tweetArticle)).toEqual({
      status: "skipped",
      username: "toggled_user",
    });
    expect(storageFake.getCalls.length).toBeGreaterThanOrEqual(2);
  });
});
