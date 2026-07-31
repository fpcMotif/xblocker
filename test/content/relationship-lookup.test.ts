// Catalog: RL-* (createRelationshipLookupRequest / parseRelationshipResponse /
// confirmDirectAction / isRateLimited). The confirmation layer ADR-0004 added to
// entrypoints/content/x-api.ts, tested directly and in isolation from the bulk
// runner's retry/backoff mechanics (covered in bulk-actions.test.ts).
import { beforeEach, describe, expect, test } from "bun:test";

import { hooks, installFetchStub, installRawFetch } from "../helpers/content-hooks.ts";
import { resetTestEnvironment, setDocumentCookie, setWindowLocation } from "../setup.ts";

describe("createRelationshipLookupRequest", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token; auth_token=session-token");
  });

  test("RL-01 builds a session-authenticated GET request keyed by target_screen_name", () => {
    const request = hooks.createRelationshipLookupRequest("test_user");

    expect(request.url).toBe(
      "https://api.x.com/1.1/friendships/show.json?target_screen_name=test_user",
    );
    expect(request.options.method).toBe("GET");
    expect(request.options.credentials).toBe("include");
    expect(request.options.headers["Authorization"]).toStartWith("Bearer ");
    expect(request.options.headers["X-Csrf-Token"]).toBe("csrf-token");
    expect(request.options.headers["X-Twitter-Active-User"]).toBe("yes");
    expect(request.options.headers["X-Twitter-Auth-Type"]).toBe("OAuth2Session");
  });

  test("RL-02 normalizes an @-prefixed handle before sending", () => {
    const request = hooks.createRelationshipLookupRequest("@test_user");
    expect(request.url).toContain("target_screen_name=test_user");
  });

  test("RL-03 throws on an invalid username before any cookie work", () => {
    expect(() => hooks.createRelationshipLookupRequest("not a handle")).toThrow(
      "Missing valid username",
    );
    expect(() => hooks.createRelationshipLookupRequest("")).toThrow("Missing valid username");
  });

  test("RL-04 throws when the ct0 CSRF cookie is missing", () => {
    setDocumentCookie("auth_token=session-token");
    expect(() => hooks.createRelationshipLookupRequest("test_user")).toThrow(
      "Missing X CSRF token",
    );
  });

  test("RL-05 throws when ct0 exists but is empty", () => {
    setDocumentCookie("ct0=; auth_token=session-token");
    expect(() => hooks.createRelationshipLookupRequest("test_user")).toThrow(
      "Missing X CSRF token",
    );
  });

  test("RL-06 targets api.twitter.com when browsing twitter.com", () => {
    setWindowLocation("https://twitter.com/user/status/1");
    const request = hooks.createRelationshipLookupRequest("test_user");
    expect(request.url).toStartWith("https://api.twitter.com/1.1/friendships/show.json");
  });
});

describe("parseRelationshipResponse", () => {
  test("RL-07 reads blocking and muting true from a well-formed body", () => {
    const status = hooks.parseRelationshipResponse(
      JSON.stringify({ relationship: { source: { blocking: true, muting: true } } }),
    );
    expect(status).toEqual({ blocking: true, muting: true });
  });

  test("RL-08 reads blocking and muting independently when they disagree", () => {
    expect(
      hooks.parseRelationshipResponse(
        JSON.stringify({ relationship: { source: { blocking: false, muting: true } } }),
      ),
    ).toEqual({ blocking: false, muting: true });
  });

  test("RL-09 defaults to false/false on malformed JSON", () => {
    expect(hooks.parseRelationshipResponse("{not valid json")).toEqual({
      blocking: false,
      muting: false,
    });
  });

  test("RL-10 defaults to false/false when the relationship/source keys are missing", () => {
    expect(hooks.parseRelationshipResponse(JSON.stringify({ unrelated: true }))).toEqual({
      blocking: false,
      muting: false,
    });
    expect(hooks.parseRelationshipResponse("")).toEqual({ blocking: false, muting: false });
  });
});

describe("confirmDirectAction", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  test("RL-11 resolves true for a block whose relationship lookup reports blocking", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    expect(await hooks.confirmDirectAction("block", "test_user")).toBe(true);
    fetchStub.uninstall();
  });

  test("RL-12 checks muting (not blocking) for a mute confirmation", async () => {
    const raw = installRawFetch(
      async () =>
        new Response(
          JSON.stringify({ relationship: { source: { blocking: false, muting: true } } }),
          { status: 200 },
        ),
    );
    try {
      expect(await hooks.confirmDirectAction("mute", "test_user")).toBe(true);
      expect(await hooks.confirmDirectAction("block", "test_user")).toBe(false);
    } finally {
      raw.restore();
    }
  });

  test("RL-13 throws a status-carrying error when the lookup responds non-2xx", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 429 }));
    let caught: unknown;
    try {
      await hooks.confirmDirectAction("block", "test_user");
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).toContain("Relationship lookup failed with HTTP 429");
    expect(hooks.isRateLimited(caught)).toBe(true);
    fetchStub.uninstall();
  });

  test("RL-14 propagates a network-level fetch rejection", async () => {
    const raw = installRawFetch(async () => {
      throw new Error("connection reset");
    });
    try {
      await hooks.confirmDirectAction("block", "test_user").then(
        () => {
          throw new Error("Expected confirmDirectAction to reject");
        },
        (error) => {
          expect(String(error)).toContain("connection reset");
        },
      );
    } finally {
      raw.restore();
    }
  });
});

describe("isRateLimited", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  test("RL-15 is false for an ordinary error and true only for a 429 status", async () => {
    expect(hooks.isRateLimited(new Error("boom"))).toBe(false);
    expect(hooks.isRateLimited(undefined)).toBe(false);

    let ordinaryFailure: unknown;
    const fetchStub = installFetchStub(() => ({ ok: false, status: 500 }));
    try {
      await hooks.confirmDirectAction("block", "test_user").catch((error: unknown) => {
        ordinaryFailure = error;
      });
    } finally {
      fetchStub.uninstall();
    }
    expect(hooks.isRateLimited(ordinaryFailure)).toBe(false);
  });
});
