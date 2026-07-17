// Catalog: URL-* (isTweetPageUrl), CK-* (getCookieValue), API-* (API base selection).
import { beforeEach, describe, expect, test } from "bun:test";

import { isTweetPageUrl } from "../../entrypoints/content/reply-actions.ts";
import {
  createDirectBlockRequest,
  createDirectMuteRequest,
  getCookieValue,
} from "../../entrypoints/content/x-api.ts";
import { resetTestEnvironment, setDocumentCookie, setWindowLocation } from "../setup.ts";

describe("isTweetPageUrl", () => {
  test("URL-01 accepts canonical tweet URLs", () => {
    expect(isTweetPageUrl("https://x.com/user/status/123456789")).toBe(true);
    expect(isTweetPageUrl("https://www.x.com/user/status/987654321")).toBe(true);
    expect(isTweetPageUrl("http://x.com/testuser/status/555666777")).toBe(true);
  });

  test("URL-02 rejects profile, home, and timeline URLs", () => {
    expect(isTweetPageUrl("https://x.com/user")).toBe(false);
    expect(isTweetPageUrl("https://x.com/home")).toBe(false);
    expect(isTweetPageUrl("https://x.com/i/timeline")).toBe(false);
  });

  test("URL-03 rejects a status path with a non-numeric id", () => {
    expect(isTweetPageUrl("https://x.com/user/status/abc")).toBe(false);
  });

  test("URL-04 BUG XB-BUG-07: unanchored pattern matches tweet URLs embedded in foreign URLs", () => {
    // The regex has no ^ anchor, so any URL *containing* a tweet URL matches.
    // Low practical impact (content script only runs on x.com), but this pins
    // the current weakness so a future anchor fix flips the expectation.
    expect(isTweetPageUrl("https://evil.example/?next=https://x.com/u/status/1")).toBe(true);
  });

  test("URL-05 localhost is rejected when the test flag is unset", () => {
    expect(isTweetPageUrl("http://localhost:5555/fixture")).toBe(false);
    expect(isTweetPageUrl("http://127.0.0.1/fixture")).toBe(false);
  });

  test("URL-07 twitter.com tweet URLs are NOT recognized (x.com only)", () => {
    expect(isTweetPageUrl("https://twitter.com/user/status/123")).toBe(false);
  });
});

describe("getCookieValue", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CK-01 reads a cookie from a multi-cookie string", () => {
    setDocumentCookie("auth_token=abc; ct0=csrf-value; lang=en");
    expect(getCookieValue("ct0")).toBe("csrf-value");
  });

  test("CK-02 returns empty string when the cookie is absent", () => {
    setDocumentCookie("auth_token=abc; lang=en");
    expect(getCookieValue("ct0")).toBe("");
  });

  test("CK-03 returns empty string for an empty cookie jar", () => {
    setDocumentCookie("");
    expect(getCookieValue("ct0")).toBe("");
  });

  test("CK-04 returns empty string when the cookie value is empty", () => {
    setDocumentCookie("ct0=; lang=en");
    expect(getCookieValue("ct0")).toBe("");
  });

  test("CK-05 keeps '=' characters inside the cookie value", () => {
    setDocumentCookie("ct0=abc=def==; lang=en");
    expect(getCookieValue("ct0")).toBe("abc=def==");
  });

  test("CK-06 does not match cookies whose name merely ends with the target", () => {
    setDocumentCookie("xct0=wrong; ct0=right");
    expect(getCookieValue("ct0")).toBe("right");
  });

  test("CK-07 BUG-ADJACENT: prefix-named cookie listed first shadows the exact name", () => {
    // startsWith("ct0=") cannot be fooled by "ct0extra=", but document this
    // explicitly because cookie parsing regressions are a recurring CSRF foot-gun.
    setDocumentCookie("ct0extra=wrong; ct0=right");
    expect(getCookieValue("ct0")).toBe("right");
  });

  test("CK-08 tolerates irregular whitespace between cookies", () => {
    setDocumentCookie("a=1;   ct0=spaced  ;b=2");
    // Each cookie segment is trimmed whole, so trailing value whitespace is lost.
    expect(getCookieValue("ct0")).toBe("spaced");
  });
});

describe("direct action API base selection", () => {
  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  test("API-01 uses api.twitter.com when the page hostname is twitter.com", () => {
    setWindowLocation("https://twitter.com/user/status/123456789");
    const request = createDirectBlockRequest("targetuser");
    expect(request.url).toBe("https://api.twitter.com/1.1/blocks/create.json");
  });

  test("API-02 uses api.x.com when the page hostname is x.com", () => {
    setWindowLocation("https://x.com/user/status/123456789");
    const request = createDirectBlockRequest("targetuser");
    expect(request.url).toBe("https://api.x.com/1.1/blocks/create.json");
  });

  test("API-03 any hostname other than bare twitter.com falls back to api.x.com", () => {
    // The hostname check is an exact string match, so even www.twitter.com
    // (and localhost fixtures) route to the api.x.com base.
    setWindowLocation("https://www.twitter.com/user/status/123456789");
    expect(createDirectBlockRequest("targetuser").url).toBe(
      "https://api.x.com/1.1/blocks/create.json",
    );

    setWindowLocation("https://example.com/fixture");
    expect(createDirectBlockRequest("targetuser").url).toBe(
      "https://api.x.com/1.1/blocks/create.json",
    );
  });

  test("API-04 mute requests share the same base selection and use the mutes endpoint", () => {
    setWindowLocation("https://twitter.com/user/status/123456789");
    expect(createDirectMuteRequest("targetuser").url).toBe(
      "https://api.twitter.com/1.1/mutes/users/create.json",
    );

    setWindowLocation("https://x.com/user/status/123456789");
    expect(createDirectMuteRequest("targetuser").url).toBe(
      "https://api.x.com/1.1/mutes/users/create.json",
    );
  });

  test("API-05 request carries the ct0 cookie as the CSRF header regardless of base", () => {
    setDocumentCookie("auth_token=abc; ct0=cookie-derived-csrf; lang=en");
    setWindowLocation("https://twitter.com/user/status/123456789");
    const request = createDirectBlockRequest("targetuser");
    expect(request.options.method).toBe("POST");
    expect(request.options.credentials).toBe("include");
    expect(request.options.headers["X-Csrf-Token"]).toBe("cookie-derived-csrf");
    expect(request.options.body).toBe("screen_name=targetuser");
  });
});
