import { blockedStore } from "../../packages/storage/blocked-store";
import {
  normalizeUsername,
  readSettings,
  DEFAULT_MAX_REPLIES,
  MAX_REPLIES_LIMIT,
} from "../../packages/storage/settings";
// Whitelist persistence lives in ../../packages/storage/whitelist-store (verified behavior-identical to
// the implementation this module used to carry).
import { getWhitelist, isWhitelisted } from "../../packages/storage/whitelist-store";
// Direct X API request/response layer and DOM author-extraction + Discover-more boundary
// detection were split out into their own modules.
import { performDirectAction, readBlockOutcome, type DirectActionType } from "./x-api";
import { getConversationReplies, extractUsernameFromTweet } from "./author";

// Every symbol the modules above used to export from here is re-exported so no existing
// import path (or test) — modal.ts, quick-block.ts, rail.ts, index.ts hooks — has to change.
export {
  addToWhitelist,
  getWhitelist,
  isWhitelisted,
  removeFromWhitelist,
  type WhitelistAddResult,
} from "../../packages/storage/whitelist-store";
export * from "./x-api";
export * from "./author";

// Re-exported so existing importers (modal.ts, index.ts hooks, tests) keep their
// `from "./actions"` path while the single definition lives in ../../packages/storage/settings.
export { normalizeUsername, DEFAULT_MAX_REPLIES, MAX_REPLIES_LIMIT };

export type ReplyActionResult =
  | { status: "blocked" | "muted" | "skipped"; username: string }
  | { status: "failed"; username?: string; reason?: string; error?: unknown };

export type BatchProgress = { done: number; total: number };
export type BatchSummary = { acted: number; skipped: number; failed: number };

const DIRECT_ACTION_DELAY_MS = 250;
const TWEET_PAGE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
const LOCAL_TEST_PAGE_PATTERN = new RegExp(String.raw`^https?://(localhost|127\.0\.0\.1)`);

export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTweetPageUrl(url: string): boolean {
  const isLocalTestPage =
    typeof globalThis !== "undefined" &&
    globalThis.__XB_TEST__ &&
    LOCAL_TEST_PAGE_PATTERN.test(url);

  return TWEET_PAGE_URL_PATTERN.test(url) || !!isLocalTestPage;
}

// Still exported for the rail's "(n)" reply-count badge (rail.ts). Reimplemented on the
// shared settings reader so the badge cap can never drift from the value a batch slices to.
export async function getMaxReplies(): Promise<number> {
  return (await readSettings()).maxReplies;
}

async function actOnTweet(
  type: DirectActionType,
  tweetArticle: Element,
  // A bulk run pre-reads the whitelist once and passes it down (lower-cased) — an empty set
  // means "skip nobody", which is how the runner honors protectWhitelist=false without
  // touching this signature. Single actions omit it and read fresh: the protectWhitelist
  // toggle scopes protection to bulk actions only (its caption promises exactly that), so a
  // per-reply act always applies the unconditional whitelist skip.
  whitelist?: ReadonlySet<string>,
): Promise<ReplyActionResult> {
  const username = extractUsernameFromTweet(tweetArticle);

  if (!username) {
    console.log("Username not found for a comment tweet.");
    return { status: "failed", reason: "missing-username" };
  }

  const skip = whitelist ? whitelist.has(username.toLowerCase()) : await isWhitelisted(username);
  if (skip) {
    console.log(`Skipping @${username}, as they are in the whitelist.`);
    return { status: "skipped", username };
  }

  let response: Response;
  try {
    response = await performDirectAction(type, username);
  } catch (error) {
    console.warn(`Direct ${type} failed for @${username}:`, error);
    return { status: "failed", username, error };
  }

  // The X action already succeeded — record it as a best-effort side-effect that can
  // never downgrade the result. The local store is the source of truth the optional
  // Convex backup drains; blocks carry the stable numeric id when X returns it, while
  // the mute endpoint gives us none, so mutes are recorded by screen name.
  await recordAction(type, response, username);
  return { status: type === "block" ? "blocked" : "muted", username };
}

async function recordAction(
  type: DirectActionType,
  response: Response,
  username: string,
): Promise<void> {
  try {
    if (type === "block") {
      const outcome = await readBlockOutcome(response, username);
      await blockedStore.record({
        handle: outcome.screen_name,
        kind: "block",
        source: "reply-bar",
        ...(outcome.id_str ? { xUserId: outcome.id_str } : {}),
      });
    } else {
      await blockedStore.record({ handle: username, kind: "mute", source: "reply-bar" });
    }
  } catch (error) {
    console.warn(`Recorded ${type} of @${username} to the local store failed:`, error);
  }
}

export function blockTweet(tweetArticle: Element): Promise<ReplyActionResult> {
  return actOnTweet("block", tweetArticle);
}

export function muteTweet(tweetArticle: Element): Promise<ReplyActionResult> {
  return actOnTweet("mute", tweetArticle);
}

export type ReplyBatchRunner = {
  /** Whether this runner is mid-run — the rail reads it to pin itself settled. */
  isRunning: () => boolean;
  run: (
    type: DirectActionType,
    onProgress?: (progress: BatchProgress) => void,
  ) => Promise<BatchSummary | null>;
};

/**
 * A single reply-batch runner. `running` is closure state (previously a module-level
 * exported mutable flag), so a run's re-entry guard is scoped to the instance instead of a
 * module global that leaks between callers and forces cross-test resets. Every automatic
 * caller (blockReplies/muteReplies) shares one default instance; a test can construct its
 * own to exercise the parked-batch path without wedging the shared one.
 */
export function createReplyBatchRunner(): ReplyBatchRunner {
  let running = false;

  async function run(
    type: DirectActionType,
    onProgress?: (progress: BatchProgress) => void,
  ): Promise<BatchSummary | null> {
    if (!isTweetPageUrl(window.location.href)) {
      console.log("Not on a tweet page. Exiting.");
      return null;
    }

    // A batch already in flight owns the page; a second concurrent invocation
    // (Block then Mute clicked quickly, or a double-fire) must not double-act.
    if (running) {
      console.log("A batch is already running.");
      return null;
    }

    // Claim the run synchronously, before the first await, so the re-entry window
    // is closed against a concurrent caller.
    running = true;
    try {
      // One settings read per batch (was: a getMaxReplies read plus a separate whitelist
      // read). protectWhitelist gates the whitelist skip to the BULK path only — the
      // caption promises exactly that ("skipped during bulk actions") — so when it is off
      // we pass an empty set (skip nobody) and never even read the whitelist.
      const settings = await readSettings();
      const replies = getConversationReplies().slice(0, settings.maxReplies);
      const whitelist = settings.protectWhitelist
        ? new Set((await getWhitelist()).map((entry) => entry.toLowerCase()))
        : new Set<string>();
      const summary: BatchSummary = { acted: 0, skipped: 0, failed: 0 };
      for (const [index, article] of replies.entries()) {
        const result = await actOnTweet(type, article, whitelist);
        if (result.status === "blocked" || result.status === "muted") {
          summary.acted++;
          if (article instanceof HTMLElement) {
            article.dataset.xbBlocked = "true";
          }
        } else if (result.status === "skipped") {
          summary.skipped++;
        } else {
          summary.failed++;
        }
        onProgress?.({ done: index + 1, total: replies.length });
        // Pace the direct API calls, but not after the last one — a trailing sleep
        // only delays the summary toast.
        if (index < replies.length - 1) {
          await waitFor(DIRECT_ACTION_DELAY_MS);
        }
      }
      console.log(
        `Finished direct ${type}. acted=${summary.acted}, skipped=${summary.skipped}, failed=${summary.failed}`,
      );
      return summary;
    } finally {
      // Clear the flag even when the run throws, so a failed batch never wedges the page.
      running = false;
    }
  }

  return { isRunning: () => running, run };
}

// The one runner every automatic bulk trigger shares.
const defaultReplyBatchRunner = createReplyBatchRunner();

/** Whether the default (shared) reply batch is mid-run — read by the rail's motion guard. */
export function isBatchRunning(): boolean {
  return defaultReplyBatchRunner.isRunning();
}

export function blockReplies(
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchSummary | null> {
  return defaultReplyBatchRunner.run("block", onProgress);
}

export function muteReplies(
  onProgress?: (progress: BatchProgress) => void,
): Promise<BatchSummary | null> {
  return defaultReplyBatchRunner.run("mute", onProgress);
}
