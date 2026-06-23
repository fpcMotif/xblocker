// Catalog: BULK-* (blockReplies / muteReplies batch runs over reply articles).
//
// Rewritten for the direct-API refactor: blockFirst20CommentTweets /
// muteFirst50CommentTweets are gone, and muting no longer walks the X
// More-menu (old DOM menu tests deleted; per-tweet direct-mute coverage lives
// in direct-mute.test.ts). The old `.xb-progress-bar` width assertions are
// replaced by onProgress assertions, and the old all-fail warning toast test
// (old BULK-08) moved to dock behavior — see ui-rendering.test.ts.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { batchState } from "../../entrypoints/content/actions.ts";
import {
  appendDiscoverMoreSection,
  createAnonymousTweetArticle,
  hooks,
  installFetchStub,
  populateTweetPage,
} from "../helpers/content-hooks.ts";
import { installImmediateTimers, settleMicrotasks } from "../helpers/timers.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

function requestBodyText(call: { init: RequestInit | undefined }): string {
  const body = call.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string");
  }
  return body;
}

describe("blockReplies", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
    setWindowLocation("https://x.com/author/status/123456789");
    // Collapses the 250ms inter-reply delay so batches finish synchronously.
    timers = installImmediateTimers();
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
    timers?.uninstall();
    timers = null;
    // batchState is a module singleton; a test that parks a batch (BULK-15/16)
    // must not leak running=true into siblings, where the guard would bail them.
    batchState.running = false;
  });

  test("BULK-01 returns null without any network traffic when not on a tweet page", async () => {
    setWindowLocation("https://x.com/author");
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two"]);

    const summary = await hooks.blockReplies();

    expect(summary).toBeNull();
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BULK-02 skips the leading main tweet and blocks only the replies", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const replies = populateTweetPage(["reply_one", "reply_two", "reply_three"]);

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ acted: 3, skipped: 0, failed: 0 });
    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=reply_one",
      "screen_name=reply_two",
      "screen_name=reply_three",
    ]);
    const main = document.querySelectorAll('article[data-testid="tweet"]')[0];
    expect(main).toBeInstanceOf(HTMLElement);
    if (main instanceof HTMLElement) {
      expect(main.dataset.xbBlocked).toBeUndefined();
    }
    for (const reply of replies) {
      expect(reply.dataset.xbBlocked).toBe("true");
    }
  });

  test("BULK-03 counts mixed whitelist/failure/success outcomes in the summary", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, init) =>
      typeof init?.body === "string" && init.body.includes("bad_user")
        ? { ok: false, status: 500 }
        : { ok: true, status: 200 },
    );
    populateTweetPage(["good_one", "safe_user", "bad_user", "good_two"]);
    // A reply with no author link counts as failed (missing-username).
    document.body.appendChild(createAnonymousTweetArticle());

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ acted: 2, skipped: 1, failed: 2 });
    // The whitelisted and anonymous replies never reach the network.
    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=good_one",
      "screen_name=bad_user",
      "screen_name=good_two",
    ]);
  });

  test("BULK-04 reports onProgress increments for every reply, including skips and failures", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, init) =>
      typeof init?.body === "string" && init.body.includes("bad_user")
        ? { ok: false, status: 500 }
        : { ok: true, status: 200 },
    );
    populateTweetPage(["good_one", "safe_user", "bad_user"]);
    const progress: Array<{ done: number; total: number }> = [];

    await hooks.blockReplies((update) => {
      progress.push({ ...update });
    });

    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  test("BULK-05 marks only successfully blocked articles with data-xb-blocked", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, init) =>
      typeof init?.body === "string" && init.body.includes("bad_user")
        ? { ok: false, status: 500 }
        : { ok: true, status: 200 },
    );
    const [blocked, whitelisted, failed] = populateTweetPage(["good_one", "safe_user", "bad_user"]);

    await hooks.blockReplies();

    expect(blocked?.dataset.xbBlocked).toBe("true");
    expect(whitelisted?.dataset.xbBlocked).toBeUndefined();
    expect(failed?.dataset.xbBlocked).toBeUndefined();
  });

  test("BULK-06 raises batchState.running for the duration of the run only", async () => {
    const observedDuringFetch: boolean[] = [];
    fetchStub = installFetchStub(() => {
      observedDuringFetch.push(batchState.running);
      return { ok: true, status: 200 };
    });
    populateTweetPage(["reply_one", "reply_two"]);

    expect(batchState.running).toBe(false);
    await hooks.blockReplies();

    expect(observedDuringFetch).toEqual([true, true]);
    expect(batchState.running).toBe(false);
  });

  test("BULK-15 a second batch started while one is in flight returns null and acts on nothing", async () => {
    // The first fetch hangs until released, so the first batch is parked mid-run
    // with batchState.running already true. A concurrent invocation must bail.
    let releaseFirst: (() => void) | null = null;
    const original = globalThis.fetch;
    const globals = globalThis as Record<string, unknown>;
    const seen: string[] = [];
    globals["fetch"] = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      seen.push(body);
      if (releaseFirst === null) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return new Response(null, { status: 200 });
    };
    populateTweetPage(["reply_one", "reply_two"]);

    try {
      const first = hooks.blockReplies();
      // Let the first batch reach (and park on) its first fetch.
      await settleMicrotasks();
      expect(batchState.running).toBe(true);
      expect(seen).toHaveLength(1);

      const second = await hooks.blockReplies();
      expect(second).toBeNull();
      // The guard returned before any await, so the second call hit no network.
      expect(seen).toHaveLength(1);

      releaseFirst!();
      const summary = await first;
      expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
      expect(batchState.running).toBe(false);
    } finally {
      globals["fetch"] = original;
    }
  });

  test("BULK-16 clears batchState.running when the run throws, so a later batch still proceeds", async () => {
    // Force the batch's first storage read (getMaxReplies) to throw after
    // batchState.running was raised. The finally must reset it — otherwise the
    // re-entry guard would permanently reject every future batch (latent deadlock).
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two"]);

    const realGet = storageFake.get.bind(storageFake);
    storageFake.get = () => {
      throw new Error("storage exploded");
    };

    let threw = false;
    try {
      await hooks.blockReplies();
    } catch {
      threw = true;
    } finally {
      storageFake.get = realGet;
    }

    expect(threw).toBe(true);
    expect(batchState.running).toBe(false);

    // The guard released cleanly: a fresh batch runs and acts on the replies.
    const summary = await hooks.blockReplies();
    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
  });

  test("BULK-07 returns an all-zero summary and never reports progress with zero replies", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage([]);
    const progress: Array<{ done: number; total: number }> = [];

    const summary = await hooks.blockReplies((update) => {
      progress.push({ ...update });
    });

    expect(summary).toEqual({ acted: 0, skipped: 0, failed: 0 });
    expect(progress).toHaveLength(0);
    expect(fetchStub.calls).toHaveLength(0);
    expect(batchState.running).toBe(false);
  });

  test("BULK-08 caps the batch at the configured maxReplies setting", async () => {
    storageFake.data["settings"] = { maxReplies: 2 };
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_1", "reply_2", "reply_3", "reply_4", "reply_5"]);

    const summary = await hooks.blockReplies();

    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=reply_1",
      "screen_name=reply_2",
    ]);
    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
  });

  test("BULK-09 caps the batch at the default of 50 when no setting is stored", async () => {
    // Replaces the old XB-BUG-04 pin: blockFirst20CommentTweets sliced to 50
    // despite the "20" in its name. The cap is now explicit via getMaxReplies.
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(Array.from({ length: 60 }, (_, i) => `reply_${i}`));

    const summary = await hooks.blockReplies();

    expect(fetchStub.calls).toHaveLength(50);
    expect(summary).toEqual({ acted: 50, skipped: 0, failed: 0 });
  });

  test("BULK-10 clamps stored maxReplies values to the 1..200 range", async () => {
    storageFake.data["settings"] = { maxReplies: 999 };
    expect(await hooks.getMaxReplies()).toBe(200);

    storageFake.data["settings"] = { maxReplies: 0 };
    expect(await hooks.getMaxReplies()).toBe(1);

    storageFake.data["settings"] = { maxReplies: "not-a-number" };
    expect(await hooks.getMaxReplies()).toBe(50);
  });

  test("BULK-14 blocks only conversation replies, never Discover more recommendations", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const replies = populateTweetPage(["reply_one", "reply_two"]);
    const recommended = appendDiscoverMoreSection(["recommended_one", "recommended_two"]);

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=reply_one",
      "screen_name=reply_two",
    ]);
    for (const reply of replies) {
      expect(reply.dataset.xbBlocked).toBe("true");
    }
    for (const rec of recommended) {
      expect(rec.dataset.xbBlocked).toBeUndefined();
    }
  });

  test("BULK-19 honors the Discover more boundary on a localized (zh-Hant) UI", async () => {
    // Regression: the boundary was matched against the exact English heading, so on
    // the zh-Hant UI this extension supports it was never found and "Block all" acted
    // on the recommended-post authors who never replied. The localized heading must
    // bound the batch exactly as the English one does.
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const replies = populateTweetPage(["reply_one", "reply_two"]);
    const recommended = appendDiscoverMoreSection(
      ["recommended_one", "recommended_two"],
      "探索更多",
    );

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=reply_one",
      "screen_name=reply_two",
    ]);
    for (const reply of replies) {
      expect(reply.dataset.xbBlocked).toBe("true");
    }
    for (const rec of recommended) {
      expect(rec.dataset.xbBlocked).toBeUndefined();
    }
  });
});

describe("muteReplies", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
    setWindowLocation("https://x.com/author/status/123456789");
    timers = installImmediateTimers();
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
    timers?.uninstall();
    timers = null;
    // batchState is a module singleton; a test that parks a batch (BULK-15/16)
    // must not leak running=true into siblings, where the guard would bail them.
    batchState.running = false;
  });

  test("BULK-11 returns null without any network traffic when not on a tweet page", async () => {
    setWindowLocation("https://x.com/author");
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one"]);

    const summary = await hooks.muteReplies();

    expect(summary).toBeNull();
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BULK-12 mutes replies via the mute endpoint, skipping the main tweet", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const replies = populateTweetPage(["reply_one", "reply_two"]);
    const progress: Array<{ done: number; total: number }> = [];

    const summary = await hooks.muteReplies((update) => {
      progress.push({ ...update });
    });

    expect(summary).toEqual({ acted: 2, skipped: 0, failed: 0 });
    expect(fetchStub.calls).toHaveLength(2);
    for (const call of fetchStub.calls) {
      expect(call.url).toBe("https://api.x.com/1.1/mutes/users/create.json");
    }
    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=reply_one",
      "screen_name=reply_two",
    ]);
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
    for (const reply of replies) {
      expect(reply.dataset.xbBlocked).toBe("true");
    }
  });

  test("BULK-13 counts whitelist skips and API failures in the mute summary", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, init) =>
      typeof init?.body === "string" && init.body.includes("bad_user")
        ? { ok: false, status: 500 }
        : { ok: true, status: 200 },
    );
    populateTweetPage(["safe_user", "bad_user", "good_one"]);

    const summary = await hooks.muteReplies();

    expect(summary).toEqual({ acted: 1, skipped: 1, failed: 1 });
    expect(fetchStub.calls.map(requestBodyText)).toEqual([
      "screen_name=bad_user",
      "screen_name=good_one",
    ]);
    expect(batchState.running).toBe(false);
  });
});
