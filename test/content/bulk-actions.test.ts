// Catalog: BULK-* (blockReplies / muteReplies batch runs over reply articles).
//
// Since ADR-0004 (issue #42), the bulk runner's per-account lifecycle is
// act -> confirm -> retry with backoff -> record: an HTTP 2xx on the create call is no
// longer sufficient on its own, so every account the runner does not skip makes AT LEAST
// two direct-API calls -- the action POST (blocks/create.json or mutes/users/create.json)
// and a relationship-lookup GET (friendships/show.json) that confirms it. `installFetchStub`
// (test/helpers/content-hooks.ts) mirrors its ok/fail decision onto the synthesized
// relationship-lookup body, so a responder that only decides success/failure per user still
// gets confirm-consistent behavior "for free" -- most tests below need nothing more. Tests
// that need act and confirm to disagree (retries, backoff, rate limiting, ledger-after-
// confirm) install their own fetch via `installRawFetch`, the same way BULK-15/16 always have.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createReplyBatchRunner, isBatchRunning } from "../../entrypoints/content/actions.ts";
import { blockedStore } from "../../packages/storage/blocked-store.ts";
import {
  actionCalls,
  appendDiscoverMoreSection,
  confirmCalls,
  createAnonymousTweetArticle,
  hooks,
  installFetchStub,
  installRawFetch,
  populateTweetPage,
  requestBodyText,
  RELATIONSHIP_LOOKUP_PATH,
  urlOf,
} from "../helpers/content-hooks.ts";
import {
  installImmediateTimers,
  installManualTimers,
  settleMicrotasks,
} from "../helpers/timers.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

describe("blockReplies", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token");
    setWindowLocation("https://x.com/author/status/123456789");
    // Collapses the schedule's inter-account delay and every retry backoff so batches
    // finish synchronously.
    timers = installImmediateTimers();
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
    timers?.uninstall();
    timers = null;
    // No cross-test reset needed: BULK-15/16 park their OWN createReplyBatchRunner()
    // instance, so a parked batch dies with the instance instead of leaking through a
    // module-global flag into sibling tests.
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

    expect(summary).toEqual({ confirmed: 3, skipped: 0, unconfirmed: 0 });
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
      "screen_name=reply_one",
      "screen_name=reply_two",
      "screen_name=reply_three",
    ]);
    // Every confirmed account is confirmed via the relationship lookup, not the 2xx alone.
    expect(confirmCalls(fetchStub.calls)).toHaveLength(3);
    const main = document.querySelectorAll('article[data-testid="tweet"]')[0];
    expect(main).toBeInstanceOf(HTMLElement);
    if (main instanceof HTMLElement) {
      expect(main.dataset.xbBlocked).toBeUndefined();
    }
    for (const reply of replies) {
      expect(reply.dataset.xbBlocked).toBe("true");
    }
  });

  test("BULK-03 counts mixed whitelist/unconfirmed/confirmed outcomes in the summary", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, __, target) =>
      target === "bad_user" ? { ok: false, status: 500 } : { ok: true, status: 200 },
    );
    populateTweetPage(["good_one", "safe_user", "bad_user", "good_two"]);
    // A reply with no author link counts as unconfirmed (missing-username).
    document.body.appendChild(createAnonymousTweetArticle());

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ confirmed: 2, skipped: 1, unconfirmed: 2 });
    // The whitelisted and anonymous replies never reach the network. bad_user's action
    // call is re-issued on every one of its 3 attempts (act+confirm both keep failing).
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
      "screen_name=good_one",
      "screen_name=bad_user",
      "screen_name=bad_user",
      "screen_name=bad_user",
      "screen_name=good_two",
    ]);
  });

  test("BULK-04 reports onProgress increments once per account, including skips and unconfirmed", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, __, target) =>
      target === "bad_user" ? { ok: false, status: 500 } : { ok: true, status: 200 },
    );
    populateTweetPage(["good_one", "safe_user", "bad_user"]);
    const progress: Array<{ done: number; total: number }> = [];

    await hooks.blockReplies((update) => {
      progress.push({ ...update });
    });

    // One increment per account regardless of how many attempts bad_user needed.
    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  test("BULK-05 marks only confirmed articles with data-xb-blocked", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, __, target) =>
      target === "bad_user" ? { ok: false, status: 500 } : { ok: true, status: 200 },
    );
    const [blocked, whitelisted, failed] = populateTweetPage(["good_one", "safe_user", "bad_user"]);

    await hooks.blockReplies();

    expect(blocked?.dataset.xbBlocked).toBe("true");
    expect(whitelisted?.dataset.xbBlocked).toBeUndefined();
    expect(failed?.dataset.xbBlocked).toBeUndefined();
  });

  test("BULK-06 raises the running flag for the duration of the run only", async () => {
    const observedDuringFetch: boolean[] = [];
    fetchStub = installFetchStub(() => {
      observedDuringFetch.push(isBatchRunning());
      return { ok: true, status: 200 };
    });
    populateTweetPage(["reply_one", "reply_two"]);

    expect(isBatchRunning()).toBe(false);
    await hooks.blockReplies();

    // Every call (act + confirm, for both accounts) sees the flag raised.
    expect(observedDuringFetch).toEqual([true, true, true, true]);
    expect(isBatchRunning()).toBe(false);
  });

  test("BULK-15 a second batch started while one is in flight returns null and acts on nothing", async () => {
    // The first fetch (reply_one's action call) hangs until released, so the first run is
    // parked mid-batch with the runner's flag already raised. A concurrent run() on the
    // SAME runner must bail. Using an instance-scoped runner (not the default) means the
    // parked state dies with it -- no cross-test reset of a module global.
    const runner = createReplyBatchRunner();
    let releaseFirst: (() => void) | null = null;
    const seen: string[] = [];
    const raw = installRawFetch(async (input) => {
      const url = urlOf(input);
      seen.push(url);
      if (releaseFirst === null) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      if (url.includes(RELATIONSHIP_LOOKUP_PATH)) {
        return new Response(
          JSON.stringify({ relationship: { source: { blocking: true, muting: true } } }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 200 });
    });
    populateTweetPage(["reply_one", "reply_two"]);

    try {
      const first = runner.run("block");
      // Let the first batch reach (and park on) its first fetch.
      await settleMicrotasks();
      expect(runner.isRunning()).toBe(true);
      expect(seen).toHaveLength(1);

      const second = await runner.run("block");
      expect(second).toBeNull();
      // The guard returned before any await, so the second call hit no network.
      expect(seen).toHaveLength(1);

      releaseFirst!();
      const summary = await first;
      expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
      expect(runner.isRunning()).toBe(false);
    } finally {
      raw.restore();
    }
  });

  test("BULK-16 clears the running flag when the run throws, so a later batch still proceeds", async () => {
    // Force the batch's first storage read (readSettings) to throw after the runner's flag
    // was raised. The finally must reset it — otherwise the re-entry guard would
    // permanently reject every future run on this instance (latent deadlock).
    const runner = createReplyBatchRunner();
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two"]);

    const realGet = storageFake.get.bind(storageFake);
    storageFake.get = () => {
      throw new Error("storage exploded");
    };

    let threw = false;
    try {
      await runner.run("block");
    } catch {
      threw = true;
    } finally {
      storageFake.get = realGet;
    }

    expect(threw).toBe(true);
    expect(runner.isRunning()).toBe(false);

    // The guard released cleanly: a fresh run on the same instance acts on the replies.
    const summary = await runner.run("block");
    expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
  });

  test("BULK-07 returns an all-zero summary and never reports progress with zero replies", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage([]);
    const progress: Array<{ done: number; total: number }> = [];

    const summary = await hooks.blockReplies((update) => {
      progress.push({ ...update });
    });

    expect(summary).toEqual({ confirmed: 0, skipped: 0, unconfirmed: 0 });
    expect(progress).toHaveLength(0);
    expect(fetchStub.calls).toHaveLength(0);
    expect(isBatchRunning()).toBe(false);
  });

  test("BULK-08 caps the batch at the configured maxReplies setting", async () => {
    storageFake.data["settings"] = { maxReplies: 2 };
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_1", "reply_2", "reply_3", "reply_4", "reply_5"]);

    const summary = await hooks.blockReplies();

    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
      "screen_name=reply_1",
      "screen_name=reply_2",
    ]);
    expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
  });

  test("BULK-09 caps the batch at the default of 50 when no setting is stored", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(Array.from({ length: 60 }, (_, i) => `reply_${i}`));

    const summary = await hooks.blockReplies();

    expect(actionCalls(fetchStub.calls)).toHaveLength(50);
    expect(confirmCalls(fetchStub.calls)).toHaveLength(50);
    expect(summary).toEqual({ confirmed: 50, skipped: 0, unconfirmed: 0 });
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

    expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
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

    expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
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

  test("BULK-20 with protectWhitelist off, a bulk run acts on a whitelisted author", async () => {
    // The toggle scopes whitelist protection to bulk actions; off means the batch skips
    // nobody, so a whitelisted handle is blocked like any other reply.
    storageFake.data["settings"] = { protectWhitelist: false };
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["safe_user", "good_one"]);

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
      "screen_name=safe_user",
      "screen_name=good_one",
    ]);
  });

  test("BULK-21 with no protectWhitelist setting stored, the whitelist still protects (default on)", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["safe_user", "good_one"]);

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ confirmed: 1, skipped: 1, unconfirmed: 0 });
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual(["screen_name=good_one"]);
  });

  test("BULK-22 reads the settings blob exactly once per batch, not once per reply", async () => {
    storageFake.data["settings"] = { maxReplies: 50, protectWhitelist: true };
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["good_one", "safe_user", "good_two"]);

    await hooks.blockReplies();

    // The runner reads maxReplies + protectWhitelist from ONE readSettings(); a regression
    // to a per-reply read would push several "settings" gets.
    const settingsReads = storageFake.getCalls.filter((keys) => keys === "settings");
    expect(settingsReads).toHaveLength(1);
  });

  test("BULK-23 retries with backoff and confirms once the account call finally succeeds", async () => {
    let actAttempts = 0;
    const raw = installRawFetch(async (input) => {
      const url = urlOf(input);
      if (url.includes(RELATIONSHIP_LOOKUP_PATH)) {
        // Confirmed exactly once the action call has succeeded at least once.
        const confirmed = actAttempts >= 2;
        return new Response(
          JSON.stringify({ relationship: { source: { blocking: confirmed, muting: confirmed } } }),
          { status: 200 },
        );
      }
      actAttempts++;
      return actAttempts < 2
        ? new Response(null, { status: 500 })
        : new Response(null, { status: 200 });
    });
    populateTweetPage(["flaky_user"]);

    try {
      const summary = await hooks.blockReplies();
      expect(summary).toEqual({ confirmed: 1, skipped: 0, unconfirmed: 0 });
      // 2 action attempts: the first fails, the second succeeds and is confirmed.
      expect(actAttempts).toBe(2);
    } finally {
      raw.restore();
    }
  });

  test("BULK-24 exhausts the attempt budget and reports the handle as unconfirmed", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 500 }));
    populateTweetPage(["never_confirms"]);
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const summary = await hooks.blockReplies();

      expect(summary).toEqual({ confirmed: 0, skipped: 0, unconfirmed: 1 });
      // 3 attempts, each an action call + a confirm call that never asserts blocking.
      expect(actionCalls(fetchStub.calls)).toHaveLength(3);
      expect(confirmCalls(fetchStub.calls)).toHaveLength(3);
      // The unconfirmed handle is named for the user to act on manually.
      expect(warnings.some((args) => String(args[0]).includes("never_confirms"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("BULK-25 a 429 (rate-limited) response backs the retry off further than an ordinary failure", async () => {
    const runner = createReplyBatchRunner({ random: () => 0 });
    const manual = installManualTimers();
    const raw = installRawFetch(async (input) => {
      const url = urlOf(input);
      if (url.includes(RELATIONSHIP_LOOKUP_PATH)) {
        return new Response(
          JSON.stringify({ relationship: { source: { blocking: false, muting: false } } }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 429 });
    });
    populateTweetPage(["rate_limited"]);

    try {
      const runPromise = runner.run("block");
      await settleMicrotasks(40);
      // Attempt 1's action call comes back 429; with zero jitter the rate-limited base
      // (4000ms) is queued for the retry, not the ordinary base (500ms).
      expect(manual.pendingDelays()).toContain(4000);
      expect(manual.pendingDelays()).not.toContain(500);

      // Each retry hop is separated by microtask-only work (the act + confirm fetch
      // calls), so draining the chain needs settle/flush interleaved, not one flush().
      for (let i = 0; i < 10; i++) {
        await settleMicrotasks();
        manual.flush();
      }
      const summary = await runPromise;
      expect(summary).toEqual({ confirmed: 0, skipped: 0, unconfirmed: 1 });
    } finally {
      raw.restore();
      manual.uninstall();
    }
  });

  test("BULK-26 the ledger only records a confirmed action, never an unconfirmed one", async () => {
    fetchStub = installFetchStub((_, __, target) =>
      target === "ghost_user" ? { ok: false, status: 500 } : { ok: true, status: 200 },
    );
    populateTweetPage(["real_spammer", "ghost_user"]);

    const summary = await hooks.blockReplies();

    expect(summary).toEqual({ confirmed: 1, skipped: 0, unconfirmed: 1 });
    const handles = (await blockedStore.list()).map((account) => account.handle);
    expect(handles).toContain("real_spammer");
    expect(handles).not.toContain("ghost_user");
  });

  test("BULK-27 confirms immediately (no retries) when the relationship lookup already shows the account blocked", async () => {
    // A re-run on a thread already processed: X's create call can reject an
    // already-blocked target even though the relationship is already correct.
    let actCalls = 0;
    const raw = installRawFetch(async (input) => {
      const url = urlOf(input);
      if (url.includes(RELATIONSHIP_LOOKUP_PATH)) {
        return new Response(
          JSON.stringify({ relationship: { source: { blocking: true, muting: true } } }),
          { status: 200 },
        );
      }
      actCalls++;
      return new Response(null, { status: 403 });
    });
    populateTweetPage(["already_blocked"]);

    try {
      const summary = await hooks.blockReplies();
      expect(summary).toEqual({ confirmed: 1, skipped: 0, unconfirmed: 0 });
      expect(actCalls).toBe(1);
    } finally {
      raw.restore();
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

    expect(summary).toEqual({ confirmed: 2, skipped: 0, unconfirmed: 0 });
    const mutes = actionCalls(fetchStub.calls);
    expect(mutes).toHaveLength(2);
    for (const call of mutes) {
      expect(call.url).toBe("https://api.x.com/1.1/mutes/users/create.json");
    }
    expect(mutes.map(requestBodyText)).toEqual(["screen_name=reply_one", "screen_name=reply_two"]);
    // The confirmation call is the shared relationship lookup, not a mute-specific one.
    expect(confirmCalls(fetchStub.calls)).toHaveLength(2);
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
    for (const reply of replies) {
      expect(reply.dataset.xbBlocked).toBe("true");
    }
  });

  test("BULK-13 counts whitelist skips and unconfirmed accounts in the mute summary", async () => {
    storageFake.data["whitelist"] = ["safe_user"];
    fetchStub = installFetchStub((_, __, target) =>
      target === "bad_user" ? { ok: false, status: 500 } : { ok: true, status: 200 },
    );
    populateTweetPage(["safe_user", "bad_user", "good_one"]);

    const summary = await hooks.muteReplies();

    expect(summary).toEqual({ confirmed: 1, skipped: 1, unconfirmed: 1 });
    expect(actionCalls(fetchStub.calls).map(requestBodyText)).toEqual([
      "screen_name=bad_user",
      "screen_name=bad_user",
      "screen_name=bad_user",
      "screen_name=good_one",
    ]);
    expect(isBatchRunning()).toBe(false);
  });

  test("BULK-28 mutes only once the relationship lookup confirms muting (not blocking)", async () => {
    // The same synthesized-body shortcut other tests lean on sets blocking and muting
    // identically; this pins the type-specific branch by disagreeing them.
    const raw = installRawFetch(async (input) => {
      const url = urlOf(input);
      if (url.includes(RELATIONSHIP_LOOKUP_PATH)) {
        return new Response(
          JSON.stringify({ relationship: { source: { blocking: false, muting: true } } }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 200 });
    });
    populateTweetPage(["muted_only_user"]);

    try {
      const summary = await hooks.muteReplies();
      expect(summary).toEqual({ confirmed: 1, skipped: 0, unconfirmed: 0 });
    } finally {
      raw.restore();
    }
  });
});
