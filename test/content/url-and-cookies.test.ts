// Catalog: URL-* (isTweetPageUrl) and CK-* (getCookieValue).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hooks } from "../helpers/content-hooks.ts";
import { resetTestEnvironment, setDocumentCookie } from "../setup.ts";

describe("isTweetPageUrl", () => {
  afterEach(() => {
    globalThis.__XB_TEST__ = undefined;
  });

  test("URL-01 accepts canonical tweet URLs", () => {
    expect(hooks.isTweetPageUrl("https://x.com/user/status/123456789")).toBe(true);
    expect(hooks.isTweetPageUrl("https://www.x.com/user/status/987654321")).toBe(true);
    expect(hooks.isTweetPageUrl("http://x.com/testuser/status/555666777")).toBe(true);
  });

  test("URL-02 rejects profile, home, and timeline URLs", () => {
    expect(hooks.isTweetPageUrl("https://x.com/user")).toBe(false);
    expect(hooks.isTweetPageUrl("https://x.com/home")).toBe(false);
    expect(hooks.isTweetPageUrl("https://x.com/i/timeline")).toBe(false);
  });

  test("URL-03 rejects a status path with a non-numeric id", () => {
    expect(hooks.isTweetPageUrl("https://x.com/user/status/abc")).toBe(false);
  });

  test("URL-04 BUG XB-BUG-07: unanchored pattern matches tweet URLs embedded in foreign URLs", () => {
    // The regex has no ^ anchor, so any URL *containing* a tweet URL matches.
    // Low practical impact (content script only runs on x.com), but this pins
    // the current weakness so a future anchor fix flips the expectation.
    expect(hooks.isTweetPageUrl("https://evil.example/?next=https://x.com/u/status/1")).toBe(true);
  });

  test("URL-05 localhost is rejected when the test flag is unset", () => {
    expect(hooks.isTweetPageUrl("http://localhost:5555/fixture")).toBe(false);
    expect(hooks.isTweetPageUrl("http://127.0.0.1/fixture")).toBe(false);
  });

  test("URL-06 localhost and 127.0.0.1 are accepted only under __XB_TEST__", () => {
    globalThis.__XB_TEST__ = true;
    expect(hooks.isTweetPageUrl("http://localhost:5555/fixture")).toBe(true);
    expect(hooks.isTweetPageUrl("https://127.0.0.1:8443/fixture")).toBe(true);
    expect(hooks.isTweetPageUrl("https://x.com/user")).toBe(false);
  });

  test("URL-07 twitter.com tweet URLs are NOT recognized (x.com only)", () => {
    expect(hooks.isTweetPageUrl("https://twitter.com/user/status/123")).toBe(false);
  });
});

describe("getCookieValue", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("CK-01 reads a cookie from a multi-cookie string", () => {
    setDocumentCookie("auth_token=abc; ct0=csrf-value; lang=en");
    expect(hooks.getCookieValue("ct0")).toBe("csrf-value");
  });

  test("CK-02 returns empty string when the cookie is absent", () => {
    setDocumentCookie("auth_token=abc; lang=en");
    expect(hooks.getCookieValue("ct0")).toBe("");
  });

  test("CK-03 returns empty string for an empty cookie jar", () => {
    setDocumentCookie("");
    expect(hooks.getCookieValue("ct0")).toBe("");
  });

  test("CK-04 returns empty string when the cookie value is empty", () => {
    setDocumentCookie("ct0=; lang=en");
    expect(hooks.getCookieValue("ct0")).toBe("");
  });

  test("CK-05 keeps '=' characters inside the cookie value", () => {
    setDocumentCookie("ct0=abc=def==; lang=en");
    expect(hooks.getCookieValue("ct0")).toBe("abc=def==");
  });

  test("CK-06 does not match cookies whose name merely ends with the target", () => {
    setDocumentCookie("xct0=wrong; ct0=right");
    expect(hooks.getCookieValue("ct0")).toBe("right");
  });

  test("CK-07 BUG-ADJACENT: prefix-named cookie listed first shadows the exact name", () => {
    // startsWith("ct0=") cannot be fooled by "ct0extra=", but document this
    // explicitly because cookie parsing regressions are a recurring CSRF foot-gun.
    setDocumentCookie("ct0extra=wrong; ct0=right");
    expect(hooks.getCookieValue("ct0")).toBe("right");
  });

  test("CK-08 tolerates irregular whitespace between cookies", () => {
    setDocumentCookie("a=1;   ct0=spaced  ;b=2");
    // Each cookie segment is trimmed whole, so trailing value whitespace is lost.
    expect(hooks.getCookieValue("ct0")).toBe("spaced");
  });
});
