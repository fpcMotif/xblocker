// Catalog: BR-* (the reply-bar block/mute loop recording into the local blocked store
// that the optional Convex backup drains). The reply-rail UI is unchanged; this only
// exercises the storage side-effect and the id_str capture from blocks/create.json.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { blockedStore } from "../../entrypoints/lib/blocked-store.ts";
import { createTweetArticle, hooks } from "../helpers/content-hooks.ts";
import { resetTestEnvironment, setDocumentCookie } from "../setup.ts";

type Restore = () => void;

/** A fetch that returns a real Response with a controllable JSON body. */
function installJsonResponder(body: string | null, status = 200): Restore {
  const original = globalThis.fetch;
  const globals = globalThis as Record<string, unknown>;
  globals["fetch"] = async () => new Response(body, { status });
  return () => {
    globals["fetch"] = original;
  };
}

/** A fetch whose (real) Response rejects when its body is read. */
function installUnreadableBodyResponder(): Restore {
  const original = globalThis.fetch;
  const globals = globalThis as Record<string, unknown>;
  globals["fetch"] = async () => {
    const response = new Response(null, { status: 200 });
    response.text = () => Promise.reject(new Error("body read failed"));
    return response;
  };
  return () => {
    globals["fetch"] = original;
  };
}

describe("reply-bar block recording", () => {
  let restore: Restore | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  test("BR-01 keys the record on the numeric id_str from the block response", async () => {
    restore = installJsonResponder(JSON.stringify({ id_str: "999", screen_name: "RealName" }));
    const { tweetArticle } = createTweetArticle("spammer");

    const result = await hooks.blockTweet(tweetArticle);
    expect(result).toEqual({ status: "blocked", username: "spammer" });

    const account = await blockedStore.get("999");
    expect(account?.xUserId).toBe("999");
    expect(account?.idUnknown).toBe(false);
    expect(account?.handle).toBe("RealName");
    expect(account?.blockCount).toBe(1);
  });

  test("BR-02 falls back to the numeric id when only `id` is present", async () => {
    restore = installJsonResponder(JSON.stringify({ id: 12345 }));
    const { tweetArticle } = createTweetArticle("spammer");

    await hooks.blockTweet(tweetArticle);

    const account = await blockedStore.get("12345");
    expect(account?.xUserId).toBe("12345");
    expect(account?.blockCount).toBe(1);
  });

  test("BR-03 records by screen name when the body carries no id", async () => {
    restore = installJsonResponder(JSON.stringify({ unrelated: true }));
    const { tweetArticle } = createTweetArticle("spammer");

    await hooks.blockTweet(tweetArticle);

    const account = await blockedStore.get("@spammer");
    expect(account?.idUnknown).toBe(true);
    expect(account?.handle).toBe("spammer");
    expect(account?.blockCount).toBe(1);
  });

  test("BR-04 still records the block when the response body cannot be read", async () => {
    restore = installUnreadableBodyResponder();
    const { tweetArticle } = createTweetArticle("spammer");

    const result = await hooks.blockTweet(tweetArticle);
    expect(result).toEqual({ status: "blocked", username: "spammer" });

    const stats = await blockedStore.stats();
    expect(stats.blocked).toBe(1);
  });

  test("BR-05 records a reply-bar mute by screen name", async () => {
    restore = installJsonResponder(null);
    const { tweetArticle } = createTweetArticle("noisy");
    document.body.appendChild(tweetArticle);

    const result = await hooks.muteTweet(tweetArticle);
    expect(result).toEqual({ status: "muted", username: "noisy" });

    const account = await blockedStore.get("@noisy");
    expect(account?.muteCount).toBe(1);
    expect(account?.idUnknown).toBe(true);
  });

  test("BR-06 records by screen name when the response body is malformed JSON", async () => {
    restore = installJsonResponder("{not valid json");
    const { tweetArticle } = createTweetArticle("spammer");

    await hooks.blockTweet(tweetArticle);

    const account = await blockedStore.get("@spammer");
    expect(account?.idUnknown).toBe(true);
    expect(account?.blockCount).toBe(1);
  });

  test("BR-07 a local-store write failure does not downgrade a successful block", async () => {
    restore = installJsonResponder(JSON.stringify({ id_str: "1" }));
    // oxlint-disable-next-line typescript/unbound-method -- captured only to restore after the test, never invoked unbound.
    const originalRecord = blockedStore.record;
    // Simulate chrome.storage throwing (e.g. extension-context-invalidated): the block
    // itself already succeeded, so the result must still be "blocked".
    blockedStore.record = () => Promise.reject(new Error("storage exploded"));
    try {
      const { tweetArticle } = createTweetArticle("spammer");
      const result = await hooks.blockTweet(tweetArticle);
      expect(result).toEqual({ status: "blocked", username: "spammer" });
    } finally {
      blockedStore.record = originalRecord;
    }
  });
});
