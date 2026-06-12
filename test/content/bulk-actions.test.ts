// Catalog: BULK-* (blockFirst20CommentTweets / muteFirst50CommentTweets / muteTweet).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createTweetArticle,
  hooks,
  installFetchStub,
  populateTweetPage,
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

function requestBodyText(call: { init: RequestInit | undefined }): string {
  const body = call.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a string");
  }
  return body;
}

describe("blockFirst20CommentTweets", () => {
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

  test("BULK-01 exits immediately when not on a tweet page", async () => {
    setWindowLocation("https://x.com/author");
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two"]);

    await hooks.blockFirst20CommentTweets();

    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BULK-02 skips the leading main tweet and blocks only the replies", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two", "reply_three"]);

    await hooks.blockFirst20CommentTweets();

    expect(fetchStub.calls).toHaveLength(3);
    const screenNames = fetchStub.calls.map(requestBodyText);
    expect(screenNames).toEqual([
      "screen_name=reply_one",
      "screen_name=reply_two",
      "screen_name=reply_three",
    ]);
  });

  test("BULK-03 BUG XB-BUG-04: caps at 50 replies despite the '20' name", async () => {
    // The function is named blockFirst20CommentTweets but slices (0, 50).
    // Pin the real cap so the naming bug is visible and a rename/refactor is safe.
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const replies = Array.from({ length: 60 }, (_, i) => `reply_${i}`);
    populateTweetPage(replies);

    await hooks.blockFirst20CommentTweets();

    expect(fetchStub.calls).toHaveLength(50);
  });

  test("BULK-04 continues past per-reply failures and blocks the rest", async () => {
    fetchStub = installFetchStub((_, init) =>
      typeof init?.body === "string" && init.body.includes("bad_user")
        ? { ok: false, status: 500 }
        : { ok: true, status: 200 },
    );
    populateTweetPage(["good_one", "bad_user", "good_two"]);

    await hooks.blockFirst20CommentTweets();

    expect(fetchStub.calls).toHaveLength(3);
  });

  test("BULK-05 advances the progress bar to 100% when replies exist", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two"]);
    const bar = document.createElement("div");
    bar.className = "xb-progress-bar";
    document.body.appendChild(bar);

    await hooks.blockFirst20CommentTweets();

    expect(bar.style.width).toBe("100%");
  });

  test("BULK-06 does nothing harmful with zero replies (only the main tweet)", async () => {
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const main = createTweetArticle("solo_author").tweetArticle;
    document.body.appendChild(main);

    await hooks.blockFirst20CommentTweets();

    expect(fetchStub.calls).toHaveLength(0);
  });

  test("BULK-07 honors the whitelist during bulk blocking", async () => {
    storageFake.data["whitelist"] = ["reply_two"];
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    populateTweetPage(["reply_one", "reply_two", "reply_three"]);

    await hooks.blockFirst20CommentTweets();

    const screenNames = fetchStub.calls.map(requestBodyText);
    expect(screenNames).toEqual(["screen_name=reply_one", "screen_name=reply_three"]);
  });

  test("BULK-08 shows a warning toast when every direct block fails", async () => {
    timers?.uninstall();
    timers = null;
    const manual = installManualTimers();
    fetchStub = installFetchStub(() => ({ ok: false, status: 403 }));
    populateTweetPage(["fail_one"]);

    try {
      const run = hooks.blockFirst20CommentTweets();
      await settleMicrotasks();
      manual.flushUpTo(250);
      await run;

      expect(document.body.textContent).toContain("Direct block failed");
      expect(manual.pendingDelays()).toContain(3000);
    } finally {
      manual.uninstall();
    }
  });
});

describe("muteTweet / muteFirst50CommentTweets", () => {
  let timers: { uninstall: () => void } | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setWindowLocation("https://x.com/author/status/123456789");
    timers = installImmediateTimers();
  });

  afterEach(() => {
    timers?.uninstall();
    timers = null;
  });

  function buildMenuTweet(username: string): {
    moreButton: HTMLElement & { clicks: number };
    tweetArticle: HTMLElement;
    confirmClicks: () => number;
  } {
    const { moreButton, tweetArticle } = createTweetArticle(username);
    let confirmClicks = 0;

    moreButton.click = () => {
      moreButton.clicks++;
      const menuItem = document.createElement("div");
      menuItem.setAttribute("role", "menuitem");
      Object.defineProperty(menuItem, "innerText", {
        configurable: true,
        value: `Mute @${username}`,
      });
      menuItem.click = () => {
        const confirm = document.createElement("button");
        confirm.setAttribute("data-testid", "confirmationSheetConfirm");
        confirm.click = () => {
          confirmClicks++;
        };
        document.body.appendChild(confirm);
      };
      document.body.appendChild(menuItem);
    };

    return { moreButton, tweetArticle, confirmClicks: () => confirmClicks };
  }

  test("BULK-08 mutes through the X menu: More -> Mute -> confirm", async () => {
    const tweet = buildMenuTweet("noisy_user");
    document.body.appendChild(tweet.tweetArticle);

    await hooks.muteTweet(tweet.tweetArticle);

    expect(tweet.moreButton.clicks).toBe(1);
    expect(tweet.confirmClicks()).toBe(1);
  });

  test("BULK-09 skips muting whitelisted users (More button never clicked)", async () => {
    storageFake.data["whitelist"] = ["noisy_user"];
    const tweet = buildMenuTweet("noisy_user");
    document.body.appendChild(tweet.tweetArticle);

    await hooks.muteTweet(tweet.tweetArticle);

    expect(tweet.moreButton.clicks).toBe(0);
    expect(tweet.confirmClicks()).toBe(0);
  });

  test("BULK-10 resolves quietly when the tweet has no More button", async () => {
    const tweetArticle = document.createElement("article");
    tweetArticle.setAttribute("data-testid", "tweet");
    const link = document.createElement("a");
    link.setAttribute("href", "/menuless_user/status/1");
    link.setAttribute("role", "link");
    tweetArticle.appendChild(link);

    await hooks.muteTweet(tweetArticle);
  });

  test("BULK-11 resolves quietly when the Mute menu item is absent", async () => {
    const { moreButton, tweetArticle } = createTweetArticle("no_menu_user");
    // moreButton.click does nothing, so no menuitem ever appears.
    document.body.appendChild(tweetArticle);

    await hooks.muteTweet(tweetArticle);
    expect(moreButton.clicks).toBe(1);
  });

  test("BULK-12 muteFirst50 exits immediately when not on a tweet page", async () => {
    setWindowLocation("https://x.com/author");
    const tweet = buildMenuTweet("noisy_user");
    document.body.appendChild(tweet.tweetArticle);

    await hooks.muteFirst50CommentTweets();

    expect(tweet.moreButton.clicks).toBe(0);
  });

  test("BULK-13 muteFirst50 skips the main tweet and updates the progress bar", async () => {
    const main = createTweetArticle("thread_author").tweetArticle;
    document.body.appendChild(main);
    const replies = ["reply_a", "reply_b"].map((name) => {
      const tweet = buildMenuTweet(name);
      document.body.appendChild(tweet.tweetArticle);
      return tweet;
    });
    const bar = document.createElement("div");
    bar.className = "xb-progress-bar";
    document.body.appendChild(bar);

    await hooks.muteFirst50CommentTweets();

    for (const reply of replies) {
      expect(reply.confirmClicks()).toBe(1);
    }
    expect(bar.style.width).toBe("100%");
  });
});
