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
} from "./actions";
import { computeRailY } from "./position";
import { QuickBlock, resolveQuickBlockMode, type QuickBlockMode } from "./quick-block";
import { COLLAPSE_GRACE_MS, DWELL_MS, ReplyRail } from "./rail";
import { ensureStyles } from "./styles";
import { applyTheme, observeThemeChanges } from "./theme";

const TWEET_PAGE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
const TIMELINE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/i/timeline`);

// The contract derives from the implementations via `typeof` so a changed signature can
// never silently desync the hooks type. Only the two closures (getQuickBlock/getRail,
// which read module-private state) and the railTimings literal are spelled out by hand.
type XBlockerTestHooks = {
  addButtons: typeof addButtons;
  blockReplies: typeof blockReplies;
  blockTweet: typeof blockTweet;
  blockUserDirectly: typeof blockUserDirectly;
  checkPageAndAddButton: typeof checkPageAndAddButton;
  computeRailY: typeof computeRailY;
  createDirectBlockRequest: typeof createDirectBlockRequest;
  createDirectMuteRequest: typeof createDirectMuteRequest;
  extractUsernameFromTweet: typeof extractUsernameFromTweet;
  getCookieValue: typeof getCookieValue;
  getMaxReplies: typeof getMaxReplies;
  getQuickBlock: () => QuickBlock | null;
  getRail: () => ReplyRail | null;
  initializeXBlocker: typeof initializeXBlocker;
  isTweetPageUrl: typeof isTweetPageUrl;
  mountQuickBlock: typeof mountQuickBlock;
  muteReplies: typeof muteReplies;
  muteTweet: typeof muteTweet;
  muteUserDirectly: typeof muteUserDirectly;
  normalizeUsername: typeof normalizeUsername;
  observeThemeChanges: typeof observeThemeChanges;
  railTimings: { dwellMs: number; collapseGraceMs: number };
  runContentScript: typeof runContentScript;
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

  ensureStyles();

  rail = new ReplyRail();
  rail.mount();

  applyTheme();
  attachGlobalListeners();

  console.log("XBlocker surfaces initialized");
}

function removeSurfaces(): void {
  rail?.destroy();
  rail = null;
}

// One-click manual block/mute (docs/adr/0001-one-click-manual-block.md). Unlike the rail,
// this is a session-long service: the default auto-confirm mode watches X's own ••• ->
// Block/Mute flow on EVERY surface (profiles, timeline, search), so it mounts once and is
// never torn down on navigation. `onActed` only fires in inline mode; auto-confirm leaves
// the block to X's native flow and never reports it.
function mountQuickBlock(mode: QuickBlockMode = resolveQuickBlockMode()): void {
  quickBlock?.destroy();
  ensureStyles();
  quickBlock = new QuickBlock({
    mode,
    onActed: (kind) => {
      if (kind === "block") {
        rail?.incrementBlocked(1);
      }
    },
  });
  quickBlock.mount();
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
  // Mount the global one-click manual-block service once; it lives for the whole
  // session and is independent of the rail's per-surface mount/teardown.
  mountQuickBlock();
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
    mountQuickBlock,
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
