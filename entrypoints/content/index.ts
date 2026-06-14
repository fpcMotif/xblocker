import { defineContentScript } from "wxt/utils/define-content-script";
import {
  blockReplies,
  blockTweet,
  blockUserDirectly,
  createDirectBlockRequest,
  createDirectMuteRequest,
  extractUsernameFromTweet,
  getCookieValue,
  getMaxReplies,
  isTweetPageUrl,
  muteReplies,
  muteTweet,
  muteUserDirectly,
  normalizeUsername,
  type BatchProgress,
  type BatchSummary,
  type DirectActionRequest,
  type ReplyActionResult,
} from "./actions";
import { computeRailY } from "./position";
import { QuickBlock, resolveQuickBlockMode } from "./quick-block";
import { COLLAPSE_GRACE_MS, DWELL_MS, ReplyRail } from "./rail";
import { ensureStyles } from "./styles";
import { applyTheme, observeThemeChanges } from "./theme";

const TWEET_PAGE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
const TIMELINE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/i/timeline`);

type XBlockerTestHooks = {
  addButtons: () => void;
  blockReplies: (onProgress?: (progress: BatchProgress) => void) => Promise<BatchSummary | null>;
  blockTweet: (tweetArticle: Element) => Promise<ReplyActionResult>;
  blockUserDirectly: (username: string) => Promise<Response>;
  checkPageAndAddButton: () => void;
  computeRailY: typeof computeRailY;
  createDirectBlockRequest: (username: string) => DirectActionRequest;
  createDirectMuteRequest: (username: string) => DirectActionRequest;
  extractUsernameFromTweet: (tweetArticle: Element) => string | null;
  getCookieValue: (name: string) => string;
  getMaxReplies: () => Promise<number>;
  getQuickBlock: () => QuickBlock | null;
  getRail: () => ReplyRail | null;
  initializeXBlocker: () => void;
  isTweetPageUrl: (url: string) => boolean;
  muteReplies: (onProgress?: (progress: BatchProgress) => void) => Promise<BatchSummary | null>;
  muteTweet: (tweetArticle: Element) => Promise<ReplyActionResult>;
  muteUserDirectly: (username: string) => Promise<Response>;
  normalizeUsername: (value: string | null | undefined) => string | null;
  observeThemeChanges: () => MutationObserver;
  railTimings: { dwellMs: number; collapseGraceMs: number };
  runContentScript: () => void;
};

declare global {
  var __XB_TEST__: boolean | undefined;
  var __xblockerTestHooks: XBlockerTestHooks | undefined;
}

let rail: ReplyRail | null = null;
let quickBlock: QuickBlock | null = null;
let listenersAttached = false;

function attachGlobalListeners(): void {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  document.addEventListener(
    "mousemove",
    (event) => {
      rail?.handleMouseMove(event);
    },
    { passive: true },
  );
  document.addEventListener(
    "scroll",
    () => {
      rail?.handleScroll();
    },
    { passive: true, capture: true },
  );
  document.addEventListener("keydown", (event) => {
    rail?.handleKeydown(event);
  });
}

function addButtons(): void {
  for (const id of ["xblocker-buttons", "xblocker-dashboard"]) {
    document.getElementById(id)?.remove();
  }
  rail?.destroy();
  quickBlock?.destroy();

  ensureStyles();

  rail = new ReplyRail();
  rail.mount();

  // The Cursor Console (or scoped auto-confirm) adds one-click manual block/mute;
  // see docs/adr/0001-one-click-manual-block.md.
  quickBlock = new QuickBlock({
    mode: resolveQuickBlockMode(),
    onActed: (kind) => {
      if (kind === "block") {
        rail?.incrementBlocked(1);
      }
    },
  });
  quickBlock.mount();

  applyTheme();
  attachGlobalListeners();

  console.log("XBlocker surfaces initialized");
}

function removeSurfaces(): void {
  rail?.destroy();
  rail = null;
  quickBlock?.destroy();
  quickBlock = null;
}

function checkPageAndAddButton(): void {
  const url = window.location.href;

  if (TIMELINE_URL_PATTERN.test(url)) {
    console.log("On timeline page. Exiting.");
    removeSurfaces();
    return;
  }

  // The rail only acts on replies, so it belongs solely on the reply region of
  // a status/tweet page -- never on profiles, search, or other surfaces.
  if (TWEET_PAGE_URL_PATTERN.test(url)) {
    addButtons();
    observeThemeChanges();
  } else {
    removeSurfaces();
  }
}

function initializeXBlocker(): void {
  checkPageAndAddButton();

  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      checkPageAndAddButton();
    }
  }).observe(document, { subtree: true, childList: true });
}

function runContentScript(): void {
  if (!globalThis.__XB_TEST__) {
    initializeXBlocker();
  }
}

if (typeof globalThis !== "undefined" && globalThis.__XB_TEST__) {
  globalThis.__xblockerTestHooks = {
    addButtons,
    blockReplies,
    blockTweet,
    blockUserDirectly,
    checkPageAndAddButton,
    computeRailY,
    createDirectBlockRequest,
    createDirectMuteRequest,
    extractUsernameFromTweet,
    getCookieValue,
    getMaxReplies,
    getQuickBlock: () => quickBlock,
    getRail: () => rail,
    initializeXBlocker,
    isTweetPageUrl,
    muteReplies,
    muteTweet,
    muteUserDirectly,
    normalizeUsername,
    observeThemeChanges,
    railTimings: { dwellMs: DWELL_MS, collapseGraceMs: COLLAPSE_GRACE_MS },
    runContentScript,
  };
}

export default defineContentScript({
  matches: ["https://x.com/*"],
  main() {
    runContentScript();
  },
});
