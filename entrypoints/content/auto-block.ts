// The Bot Sentry's DOM-facing half: passively scans the visible conversation replies for
// the spam-classifier.ts verdict and, when the autoBlockSpam setting is on (off by
// default — see packages/storage/settings.ts), blocks the match through the same direct
// API + local-store path the reply rail uses, recorded under the "auto" BlockSource so the
// options page's Blocked log can show/filter which entries were regex/lexicon auto-blocks.
//
// Off by default because auto-block is a hard-to-reverse, site-wide action driven by a
// heuristic verdict — see spam-classifier.ts's precision-first design note. Turning the
// setting on is the user's explicit call (entrypoints/options/panes/general.ts), not a
// default this module imposes.
import {
  extractDisplayNameFromTweet,
  extractReplyBodyFromTweet,
  extractThreadAuthor,
  extractUsernameFromTweet,
  getConversationReplies,
  hasResearchOrCodeLinks,
  isWhitelisted,
  performDirectAction,
  recordAction,
  waitFor,
} from "./actions";
import { classify } from "./spam-classifier";
import { readSettings, type Settings } from "../../packages/storage/settings";
import { showToast } from "./toast";

// A short pace between successive auto-blocks in one scan pass, mirroring the bulk
// runner's own pacing philosophy (actions.ts's SCHEDULE_BASE_DELAY_MS) -- a burst of spam
// replies should never hammer X's API back-to-back.
const AUTO_BLOCK_PACING_MS = 250;

export type SpamAutoBlockerOptions = {
  /** Fired after a confirmed auto-block (e.g. to bump the rail's session count). */
  onBlocked?: (username: string) => void;
};

export class SpamAutoBlocker {
  private readonly onBlocked: (username: string) => void;
  private observer: MutationObserver | null = null;
  // A scan is async (settings read, per-article classify + block); a mutation batch that
  // arrives mid-scan queues one more pass rather than overlapping it.
  private scanning = false;
  private rescanQueued = false;
  // mount()'s own initial scan() is already in flight the instant destroy() can be called
  // (e.g. a fast navigate-away right after mount, per index.ts's checkPageAndAddButton) --
  // disconnecting the observer alone does not stop a scan that already started, so runScan
  // checks this flag before ever touching the DOM.
  private destroyed = false;

  constructor(options: SpamAutoBlockerOptions = {}) {
    this.onBlocked = options.onBlocked ?? (() => {});
  }

  mount(): void {
    this.observer = new MutationObserver(() => {
      this.scan();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scan();
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Observer entry point; also called directly in tests for determinism. */
  scan(): void {
    if (this.destroyed) {
      return;
    }
    if (this.scanning) {
      this.rescanQueued = true;
      return;
    }
    this.scanning = true;
    void this.runScan().finally(() => {
      this.scanning = false;
      if (this.rescanQueued) {
        this.rescanQueued = false;
        this.scan();
      }
    });
  }

  private async runScan(): Promise<void> {
    const settings = await readSettings();
    // destroy() can land while this read was in flight (e.g. a fast navigate-away right
    // after mount's own initial scan) -- disconnecting the observer doesn't reach back
    // into an already-started scan, so this checks explicitly before touching the DOM.
    if (this.destroyed || !settings.autoBlockSpam) {
      // Nothing is marked scanned while the setting is off, so turning it on later
      // re-considers every reply currently on the page, not just future ones.
      return;
    }

    const threadAuthor = settings.protectThreadAuthor ? extractThreadAuthor() : null;
    for (const article of getConversationReplies()) {
      if (this.destroyed) {
        return;
      }
      if (!(article instanceof HTMLElement) || article.dataset.xbSpamScanned === "true") {
        continue;
      }
      // Mark BEFORE awaiting so a mutation fired mid-classification can never re-enter
      // the same article.
      article.dataset.xbSpamScanned = "true";
      const blocked = await this.classifyAndAct(article, settings, threadAuthor);
      if (blocked) {
        await waitFor(AUTO_BLOCK_PACING_MS);
      }
    }
  }

  /** Returns true when this article was matched and successfully auto-blocked. */
  private async classifyAndAct(
    article: Element,
    settings: Settings,
    threadAuthor: string | null,
  ): Promise<boolean> {
    if (article instanceof HTMLElement && article.dataset.xbBlocked === "true") {
      return false; // already acted on (manually or by an earlier auto-block pass)
    }

    const username = extractUsernameFromTweet(article);
    if (!username) {
      return false;
    }

    const verdict = classify({
      displayName: extractDisplayNameFromTweet(article),
      handle: username,
      body: extractReplyBodyFromTweet(article),
    });
    if (!verdict.block) {
      return false;
    }

    if (threadAuthor !== null && username.toLowerCase() === threadAuthor.toLowerCase()) {
      console.log(`Skipping @${username}: original thread author.`);
      return false;
    }
    if (settings.protectResearchLinks && hasResearchOrCodeLinks(article)) {
      console.log(`Skipping @${username}: contains arXiv/GitHub link.`);
      return false;
    }

    if (await isWhitelisted(username)) {
      return false;
    }

    try {
      const response = await performDirectAction("block", username);
      await recordAction("block", username, response, "auto");
      if (article instanceof HTMLElement) {
        article.dataset.xbBlocked = "true";
      }
      this.onBlocked(username);
      showToast(`Auto-blocked @${username} (spam match)`, "info");
      return true;
    } catch (error) {
      console.warn(`Auto-block failed for @${username}:`, error);
      return false;
    }
  }
}
