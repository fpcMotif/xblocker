// Catalog: DM-* (createDirectMuteRequest / muteUserDirectly / muteTweet direct mute flow).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { muteTweet } from "../../entrypoints/content/reply-actions.ts";
import { createDirectMuteRequest, muteUserDirectly } from "../../entrypoints/content/x-api.ts";
import {
  createTweetArticle,
  installFetchStub,
  installRejectingFetch,
} from "../helpers/content-dom.ts";
import { resetTestEnvironment, setDocumentCookie, storageFake } from "../setup.ts";

const api = { createDirectMuteRequest, muteTweet, muteUserDirectly };

describe("direct mute flow", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token; auth_token=session-token");
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
  });

  test("DM-01 creates a session-authenticated direct mute request by screen name", () => {
    const request = api.createDirectMuteRequest("@test_user");

    expect(request.url).toBe("https://api.x.com/1.1/mutes/users/create.json");
    expect(request.options.method).toBe("POST");
    expect(request.options.credentials).toBe("include");
    expect(request.options.headers["Authorization"]).toStartWith("Bearer ");
    expect(request.options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(request.options.headers["X-Csrf-Token"]).toBe("csrf-token");
    expect(request.options.headers["X-Twitter-Active-User"]).toBe("yes");
    expect(request.options.headers["X-Twitter-Auth-Type"]).toBe("OAuth2Session");
    expect(request.options.body).toBe("screen_name=test_user");
  });

  test("DM-02 mutes directly without the X More menu or confirmation modal", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { moreButton, tweetArticle } = createTweetArticle("direct_user");
    document.body.appendChild(tweetArticle);

    const result = await api.muteTweet(tweetArticle);

    expect(result).toEqual({ status: "muted", username: "direct_user" });
    expect(fetchStub.calls).toHaveLength(1);
    expect(fetchStub.calls[0]?.url).toBe("https://api.x.com/1.1/mutes/users/create.json");
    expect(fetchStub.calls[0]?.init?.body).toBe("screen_name=direct_user");
    expect(moreButton.clicks).toBe(0);
    expect(document.querySelector('[data-testid="confirmationSheetConfirm"]')).toBeNull();
  });

  test("DM-03 skips direct mute requests for whitelisted users", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const { moreButton, tweetArticle } = createTweetArticle("safe_user");
    document.body.appendChild(tweetArticle);

    const result = await api.muteTweet(tweetArticle);

    expect(result).toEqual({ status: "skipped", username: "safe_user" });
    expect(fetchStub.calls).toHaveLength(0);
    expect(moreButton.clicks).toBe(0);
  });

  test("DM-04 reports a failed mute when the X API rejects the request", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 403 }));
    const { tweetArticle } = createTweetArticle("rejected_user");
    document.body.appendChild(tweetArticle);

    const result = await api.muteTweet(tweetArticle);

    expect(result.status).toBe("failed");
    expect(result.username).toBe("rejected_user");
    if (result.status === "failed") {
      expect(String(result.error)).toContain("HTTP 403");
    }
  });

  test("DM-05 fails early when the X csrf cookie is unavailable", () => {
    setDocumentCookie("");

    expect(() => api.createDirectMuteRequest("test_user")).toThrow("Missing X CSRF token");
  });
});

describe("muteUserDirectly", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
  });

  test("DM-06 performs exactly one POST to the mute endpoint and resolves on HTTP 200", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));

    const response = await api.muteUserDirectly("direct_user");

    expect(response.status).toBe(200);
    expect(fetchStub.calls).toHaveLength(1);
    const call = fetchStub.calls[0]!;
    expect(call.url).toBe("https://api.x.com/1.1/mutes/users/create.json");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe("screen_name=direct_user");
  });

  test("DM-07 throws with the HTTP status when the mute API rejects", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 403 }));
    await api.muteUserDirectly("direct_user").then(
      () => {
        throw new Error("Expected direct mute to reject");
      },
      (error) => {
        expect(String(error)).toContain("Direct mute failed with HTTP 403");
      },
    );
  });

  test("DM-08 propagates network-level fetch rejections", async () => {
    const rejecting = installRejectingFetch("connection reset");
    try {
      await api.muteUserDirectly("direct_user").then(
        () => {
          throw new Error("Expected direct mute to reject");
        },
        (error) => {
          expect(String(error)).toContain("connection reset");
        },
      );
      expect(rejecting.calls).toHaveLength(1);
    } finally {
      rejecting.uninstall();
    }
  });

  test("DM-09 never calls fetch when the CSRF cookie is missing", async () => {
    setDocumentCookie("");
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    await api.muteUserDirectly("direct_user").then(
      () => {
        throw new Error("Expected direct mute to reject");
      },
      (error) => {
        expect(String(error)).toContain("Missing X CSRF token");
      },
    );
    expect(fetchStub.calls).toHaveLength(0);
  });
});
