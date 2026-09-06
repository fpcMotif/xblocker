// Catalog: AB-* (SpamAutoBlocker: the Bot Sentry's DOM-facing scan/act loop). The
// classifier's own precision is pinned in spam-classifier.test.ts; these tests exercise the
// settings gate, whitelist, dedup-by-dataset, pacing, and observer lifecycle around it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { SpamAutoBlocker } from "../../entrypoints/content/auto-block.ts";
import {
  createAnonymousTweetArticle,
  createTweetArticle,
  hooks,
  installFetchStub,
  populateTweetPage,
} from "../helpers/content-hooks.ts";
import { installManualTimers, settleMicrotasks } from "../helpers/timers.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  await tick();
  await tick();
  await tick();
}

/** "bitcoin" and "ethereum" are both valid X handles (letters only, <=15 chars) AND exact
 *  crypto-lexicon entries, so classify() blocks them on the handle text alone (STRONG,
 *  crypto-strong) -- no need to fabricate a byline/tweetText fixture for displayName/body. */
function spamReply(handle: "bitcoin" | "ethereum" = "bitcoin"): HTMLElement {
  const [reply] = populateTweetPage([handle]);
  if (!reply) throw new Error("expected a reply article");
  return reply;
}

function enableAutoBlock(): void {
  storageFake.data["settings"] = { autoBlockSpam: true };
}

beforeEach(() => {
  resetTestEnvironment();
  setDocumentCookie("ct0=csrf-token");
});

describe("SpamAutoBlocker", () => {
  let bot: SpamAutoBlocker | null = null;

  afterEach(() => {
    bot?.destroy();
    bot = null;
  });

  test("AB-01 the setting off (default) never blocks a spam-shaped reply", async () => {
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
    expect(reply.dataset.xbSpamScanned).toBeUndefined(); // never marked while off
  });

  test("AB-02 blocks a spam-matched reply, records it as auto, toasts, and fires onBlocked", async () => {
    enableAutoBlock();
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));
    const blockedHandles: string[] = [];

    bot = new SpamAutoBlocker({ onBlocked: (username) => blockedHandles.push(username) });
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls.some((call) => call.url.includes("/blocks/create.json"))).toBe(true);
    expect(reply.dataset.xbBlocked).toBe("true");
    expect(reply.dataset.xbSpamScanned).toBe("true");
    expect(blockedHandles).toEqual(["bitcoin"]);
    const toast = document.querySelector('.xb-toast[data-type="info"]');
    expect(toast?.textContent).toContain("bitcoin");
  });

  test("AB-03 an ordinary (non-matching) reply is left alone", async () => {
    enableAutoBlock();
    const [normal] = populateTweetPage(["normaluser"]);
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(normal?.dataset.xbBlocked).toBeUndefined();
    expect(normal?.dataset.xbSpamScanned).toBe("true"); // considered, just not matched
  });

  test("AB-04 a whitelisted spam-matched author is skipped, not blocked", async () => {
    enableAutoBlock();
    storageFake.data["whitelist"] = ["bitcoin"];
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
  });

  test("AB-05 an article already blocked (manually, or by an earlier pass) is never re-acted on", async () => {
    enableAutoBlock();
    const reply = spamReply();
    reply.dataset.xbBlocked = "true";
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
  });

  test("AB-06 an article with no resolvable author does not crash and is not acted on", async () => {
    enableAutoBlock();
    const anonymous = createAnonymousTweetArticle();
    document.body.appendChild(createTweetArticle("thread_author").tweetArticle);
    document.body.appendChild(anonymous);
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    expect(() => bot?.scan()).not.toThrow();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
  });

  test("AB-07 repeated scans never re-process the same article (dataset-marked dedup)", async () => {
    enableAutoBlock();
    spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls.filter((call) => call.url.includes("/blocks/create.json"))).toHaveLength(1);
  });

  test("AB-08 turning the setting on after an initial off scan still catches replies already on the page", async () => {
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan(); // off: nothing marked
    await settle();
    enableAutoBlock();
    bot.scan(); // on: the same, still-unmarked article is now considered
    await settle();
    stub.uninstall();

    expect(reply.dataset.xbBlocked).toBe("true");
  });

  test("AB-09 a failed block does not crash, mark blocked, or fire onBlocked", async () => {
    enableAutoBlock();
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: false, status: 500 }));
    let onBlockedCalls = 0;

    bot = new SpamAutoBlocker({ onBlocked: () => onBlockedCalls++ });
    bot.scan();
    await settle();
    stub.uninstall();

    expect(reply.dataset.xbBlocked).toBeUndefined();
    expect(onBlockedCalls).toBe(0);
  });

  test("AB-10 mount observes the DOM and blocks a spam reply added later", async () => {
    enableAutoBlock();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.mount();

    const reply = spamReply();
    await settle();
    stub.uninstall();

    expect(reply.dataset.xbBlocked).toBe("true");
  });

  test("AB-11 destroy stops an already-in-flight mount() scan, not just future observer callbacks", async () => {
    // Regression: mount()'s own initial scan() is already running (suspended on the
    // settings read) the instant destroy() can be called, e.g. index.ts's
    // checkPageAndAddButton navigating away right after mounting. Disconnecting the
    // observer alone does not stop that in-flight scan from later resuming and acting on
    // whatever the DOM looks like by the time its await resolves.
    enableAutoBlock();
    bot = new SpamAutoBlocker();
    bot.mount();
    bot.destroy();

    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
  });

  test("AB-12 a scan already in flight queues one more pass instead of overlapping it", async () => {
    enableAutoBlock();
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    bot.scan(); // fires while the first is still awaiting settings/whitelist/fetch
    await settle();
    stub.uninstall();

    expect(stub.calls.filter((call) => call.url.includes("/blocks/create.json"))).toHaveLength(1);
    expect(reply.dataset.xbBlocked).toBe("true");
  });

  test("AB-13 paces successive auto-blocks in one pass rather than firing back-to-back", async () => {
    enableAutoBlock();
    const first = spamReply("bitcoin");
    const [second] = populateTweetPage(["ethereum"]);
    if (!second) throw new Error("expected a second reply article");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));
    // Manual timers intercept setTimeout, so waiting here must use settleMicrotasks (pure
    // Promise.resolve() ticks) rather than this file's setTimeout-based settle()/tick().
    const timers = installManualTimers();

    try {
      bot = new SpamAutoBlocker();
      bot.scan();
      await settleMicrotasks(30);

      // The first block completed; the pacing wait (queued via setTimeout) blocks the loop
      // before it ever reaches the second article.
      expect(first.dataset.xbBlocked).toBe("true");
      expect(second.dataset.xbBlocked).toBeUndefined();
      expect(timers.pendingDelays()).toContain(250);

      timers.flush();
      await settleMicrotasks(30);

      expect(second.dataset.xbBlocked).toBe("true");
    } finally {
      timers.uninstall();
      stub.uninstall();
    }
  });

  test("AB-14 skips a spam-matched reply from the original thread author", async () => {
    enableAutoBlock();
    setWindowLocation("https://x.com/bitcoin/status/123456789");
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
  });

  test("AB-15 skips a spam-matched reply containing a protected research link", async () => {
    enableAutoBlock();
    const reply = spamReply();
    const body = document.createElement("div");
    body.setAttribute("data-testid", "tweetText");
    body.textContent = "source: https://github.com/example/project";
    reply.appendChild(body);
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
  });

  test("AB-16 acts on a research-link spam match when protection is disabled", async () => {
    storageFake.data["settings"] = { autoBlockSpam: true, protectResearchLinks: false };
    const reply = spamReply();
    const body = document.createElement("div");
    body.setAttribute("data-testid", "tweetText");
    body.textContent = "source: https://arxiv.org/abs/2301.00000";
    reply.appendChild(body);
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    bot = new SpamAutoBlocker();
    bot.scan();
    await settle();
    stub.uninstall();

    expect(reply.dataset.xbBlocked).toBe("true");
  });
});

describe("index.ts wiring", () => {
  afterEach(() => {
    hooks.getSpamAutoBlocker()?.destroy();
  });

  test("AB-20 addButtons mounts a SpamAutoBlocker; removeSurfaces tears it down", () => {
    hooks.addButtons();
    expect(hooks.getSpamAutoBlocker()).not.toBeNull();
  });

  test("AB-21 an auto-block bumps the rail's session count via onBlocked", async () => {
    enableAutoBlock();
    const reply = spamReply();
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    hooks.addButtons();
    await settle();
    stub.uninstall();

    expect(reply.dataset.xbBlocked).toBe("true");
    const sessionCount = hooks.getRail()?.root.querySelector(".xb-session-count");
    expect(sessionCount?.textContent).toBe("1");
  });
});
