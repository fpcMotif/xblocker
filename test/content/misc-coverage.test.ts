// Catalog: MC-* (isReplyArticle reply classification).
//
// Why this file exists: Bun 1.4 canary only records LINE hits for reply-actions.ts
// in a test file that also drives runReplyBatch (blockReplies/muteReplies).
// rail-state.test.ts executes the isReplyArticle guard on every region check,
// but without a batch run in that file the `return false` guard stays
// unattributed in the full-suite coverage table. MC-01 is the batch warm-up
// that unlocks attribution here; MC-02..MC-05 pin the classification
// contract, including the reply-is-true branch no other file asserts.
import { beforeEach, describe, expect, test } from "bun:test";

import { isReplyArticle } from "../../entrypoints/content/author.ts";
import { muteReplies } from "../../entrypoints/content/reply-actions.ts";
import {
  appendDiscoverMoreSection,
  createTweetArticle,
  populateTweetPage,
} from "../helpers/content-dom.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("isReplyArticle", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("MC-01 a mute batch over a page with no articles acts on nothing", async () => {
    expect(await muteReplies()).toEqual({ acted: 0, skipped: 0, failed: 0 });
  });

  test("MC-02 elements that are not tweet articles are never replies", () => {
    const div = document.createElement("div");
    const bareArticle = document.createElement("article");
    document.body.append(div, bareArticle);

    expect(isReplyArticle(div)).toBe(false);
    expect(isReplyArticle(bareArticle)).toBe(false);
  });

  test("MC-03 the leading main tweet is not a reply", () => {
    populateTweetPage([]);
    const main = document.querySelector('article[data-testid="tweet"]');
    expect(main).toBeTruthy();
    if (!main) {
      return;
    }

    expect(isReplyArticle(main)).toBe(false);
  });

  test("MC-04 every tweet article after the first is a reply", () => {
    const replies = populateTweetPage(["reply_one", "reply_two"]);
    expect(replies).toHaveLength(2);

    for (const reply of replies) {
      expect(isReplyArticle(reply)).toBe(true);
    }
  });

  test("MC-05 a detached tweet article is not a reply when the page has none", () => {
    const { tweetArticle } = createTweetArticle("detached_author");

    expect(isReplyArticle(tweetArticle)).toBe(false);
  });

  test("MC-06 a recommended post in the Discover more module is not a reply", () => {
    populateTweetPage(["real_reply"]);
    const [recommended] = appendDiscoverMoreSection(["recommended_one"]);
    expect(recommended).toBeTruthy();
    if (!recommended) {
      return;
    }

    expect(isReplyArticle(recommended)).toBe(false);
  });

  test("MC-07 a genuine reply above the Discover more module is still a reply", () => {
    const [reply] = populateTweetPage(["real_reply"]);
    appendDiscoverMoreSection(["recommended_one"]);
    expect(reply).toBeTruthy();
    if (!reply) {
      return;
    }

    expect(isReplyArticle(reply)).toBe(true);
  });
});
