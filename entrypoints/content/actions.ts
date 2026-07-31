import { blockedStore } from "../../packages/storage/blocked-store";
import { normalizeUsername, readSettings } from "../../packages/storage/settings";
// Whitelist persistence lives in ../../packages/storage/whitelist-store (verified behavior-identical to
// the implementation this module used to carry).
import { getWhitelist, isWhitelisted } from "../../packages/storage/whitelist-store";
// Direct X API request/response layer and DOM author-extraction + Discover-more boundary
// detection were split out into their own modules.
import {
  confirmDirectAction,
  isRateLimited,
  performDirectAction,
  readBlockOutcome,
  type DirectActionType,
} from "./x-api";
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

// Re-exported so existing importers keep their `from "./actions"` path while the
// single definition lives in ../../packages/storage/settings.
export { normalizeUsername };

export type ReplyActionResult =
  | { status: "blocked" | "muted" | "skipped"; username: string }
  | { status: "failed"; username?: string; reason?: string; error?: unknown };

export type BatchProgress = { done: number; total: number };
/** `confirmed` counts only accounts the relationship lookup actually asserted are
 *  blocked/muted; `unconfirmed` covers both a missing username and an account whose
 *  confirmation never came back true within its attempt budget (see ADR-0004). */
export type BatchSummary = { confirmed: number; skipped: number; unconfirmed: number };

// Inter-account pacing: unchanged from the pre-confirm runner (kept a fixed delay, no
// jitter, on purpose -- the rail's on-button progress tests pin exact 250ms ticks).
// "Base delay plus jitter" per the confirm-and-retry spec lands on the RETRY backoff
// below instead, which has no legacy timing to preserve.
const SCHEDULE_BASE_DELAY_MS = 250;
// A bounded act -> confirm attempt budget per account: enough for a transient failure
// or a slow-to-settle confirmation to clear without letting one stuck account stall a
// batch indefinitely.
const MAX_ACCOUNT_ATTEMPTS = 3;
// Exponential backoff (2^(attempt-1) * base, plus jitter) between an account's attempts.
// A rate-limit-shaped (429) failure uses the much larger RATE_LIMIT_* base so the
// schedule visibly slows down instead of burning through the rest of the batch.
const RETRY_BASE_DELAY_MS = 500;
const RETRY_JITTER_MS = 250;
const RATE_LIMIT_BASE_DELAY_MS = 4000;
const RATE_LIMIT_JITTER_MS = 2000;

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

// Shared by the single-reply path below and the bulk runner's loop: a reply article
// with no resolvable author link is classified identically everywhere, with the same
// console note. What each caller DOES with a missing username differs (a failed
// ReplyActionResult here vs. an unconfirmed batch tally in the runner), so only the
// extraction + logging is factored out, not the outcome shape.
function resolveUsername(tweetArticle: Element): string | null {
  const username = extractUsernameFromTweet(tweetArticle);
  if (!username) {
    console.log("Username not found for a comment tweet.");
  }
  return username;
}

// Single-action path (Cursor Console's blockTweet/muteTweet): always reads the
// whitelist fresh, per-call. This intentionally does NOT share a check with the bulk
// runner's loop below, which instead tests membership in a whitelist Set the batch
// pre-read ONCE (settings.protectWhitelist gates that skip to bulk only, per its
// caption) — unifying the two would force either a per-reply whitelist read on every
// bulk account (defeating BULK-22's one-read-per-batch guarantee) or a stale cached
// whitelist on the single-reply path (the behavior BT-07 exists to rule out).
async function actOnTweet(
  type: DirectActionType,
  tweetArticle: Element,
): Promise<ReplyActionResult> {
  const username = resolveUsername(tweetArticle);
  if (!username) {
    return { status: "failed", reason: "missing-username" };
  }

  if (await isWhitelisted(username)) {
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
  // the mute endpoint gives us none, so mutes are recorded by screen name. The Cursor
  // Console's single-reply path is out of scope for confirm-then-record (ADR-0004): it
  // stays on the pre-existing record-on-2xx behavior.
  await recordAction(type, username, response);
  return { status: type === "block" ? "blocked" : "muted", username };
}

/** Persist a successful direct action to the local store. `response` is the create
 *  call's response when one exists (the single-reply path always has one; the bulk
 *  runner may confirm an account as blocked/muted without ever seeing a successful
 *  create response of its own -- e.g. a prior run already did it -- in which case it
 *  omits `response` and this records by screen name instead of the response body). */
async function recordAction(
  type: DirectActionType,
  username: string,
  response?: Response,
): Promise<void> {
  try {
    if (type === "block") {
      const outcome = response
        ? await readBlockOutcome(response, username)
        : { screen_name: normalizeUsername(username) ?? username };
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

export type ReplyBatchRunnerOptions = {
  /** Jitter source for the retry backoff delays; defaults to Math.random. Tests inject
   *  a fixed value (e.g. `() => 0`) to make backoff delays deterministic. */
  random?: () => number;
};

function jitter(random: () => number, maxMs: number): number {
  return Math.floor(random() * maxMs);
}

/** Exponential backoff for an account's next act/confirm attempt: doubles per attempt,
 *  plus jitter. A rate-limit-shaped failure anywhere in the attempt (act or confirm)
 *  uses the much larger RATE_LIMIT_* base — "waits meaningfully longer than an ordinary
 *  failure" — and that choice persists for the rest of this account's attempts, since a
 *  rate limit rarely clears by the very next retry. */
function accountRetryDelayMs(attempt: number, rateLimited: boolean, random: () => number): number {
  const base = rateLimited ? RATE_LIMIT_BASE_DELAY_MS : RETRY_BASE_DELAY_MS;
  const jitterMax = rateLimited ? RATE_LIMIT_JITTER_MS : RETRY_JITTER_MS;
  return base * 2 ** (attempt - 1) + jitter(random, jitterMax);
}

type AccountLifecycleResult =
  | { confirmed: true; response: Response | undefined }
  | { confirmed: false };

/**
 * One account's bulk lifecycle: act, then confirm against X's own relationship state,
 * retrying with backoff until confirmed or the attempt budget is exhausted. An HTTP 2xx
 * on the create call is no longer sufficient on its own (ADR-0004) — only a relationship
 * lookup that asserts the block/mute counts. The act call is re-issued on every attempt
 * (blocks/create.json and mutes/users/create.json are idempotent against an
 * already-blocked/muted target), but confirmation is the sole source of truth: even an
 * attempt whose act call fails still confirms immediately if the lookup already shows
 * the account blocked/muted (e.g. a prior run on this same thread already did it), so a
 * re-run never pays for retries it doesn't need.
 */
async function runAccountLifecycle(
  type: DirectActionType,
  username: string,
  random: () => number,
): Promise<AccountLifecycleResult> {
  let rateLimited = false;

  for (let attempt = 1; attempt <= MAX_ACCOUNT_ATTEMPTS; attempt++) {
    let response: Response | undefined;
    try {
      response = await performDirectAction(type, username);
    } catch (error) {
      console.warn(`Direct ${type} failed for @${username} (attempt ${attempt}):`, error);
      if (isRateLimited(error)) rateLimited = true;
    }

    try {
      if (await confirmDirectAction(type, username)) {
        return { confirmed: true, response };
      }
    } catch (error) {
      console.warn(`Confirming ${type} of @${username} failed (attempt ${attempt}):`, error);
      if (isRateLimited(error)) rateLimited = true;
    }

    if (attempt < MAX_ACCOUNT_ATTEMPTS) {
      await waitFor(accountRetryDelayMs(attempt, rateLimited, random));
    }
  }

  return { confirmed: false };
}

/**
 * A single reply-batch runner. `running` is closure state (previously a module-level
 * exported mutable flag), so a run's re-entry guard is scoped to the instance instead of a
 * module global that leaks between callers and forces cross-test resets. Every automatic
 * caller (blockReplies/muteReplies) shares one default instance; a test can construct its
 * own to exercise the parked-batch path without wedging the shared one.
 */
export function createReplyBatchRunner(options: ReplyBatchRunnerOptions = {}): ReplyBatchRunner {
  let running = false;
  const random = options.random ?? Math.random;

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
      const summary: BatchSummary = { confirmed: 0, skipped: 0, unconfirmed: 0 };
      const unconfirmedHandles: string[] = [];
      for (const [index, article] of replies.entries()) {
        const username = resolveUsername(article);
        if (!username) {
          summary.unconfirmed++;
        } else if (whitelist.has(username.toLowerCase())) {
          // Whitelisted accounts are skipped before they are ever scheduled: no act,
          // no confirm, no network traffic at all.
          console.log(`Skipping @${username}, as they are in the whitelist.`);
          summary.skipped++;
        } else {
          const outcome = await runAccountLifecycle(type, username, random);
          if (outcome.confirmed) {
            summary.confirmed++;
            if (article instanceof HTMLElement) {
              article.dataset.xbBlocked = "true";
            }
            await recordAction(type, username, outcome.response);
          } else {
            summary.unconfirmed++;
            unconfirmedHandles.push(username);
          }
        }
        onProgress?.({ done: index + 1, total: replies.length });
        // Pace the schedule, but not after the last one — a trailing sleep only
        // delays the summary toast.
        if (index < replies.length - 1) {
          await waitFor(SCHEDULE_BASE_DELAY_MS);
        }
      }
      if (unconfirmedHandles.length > 0) {
        console.warn(`Could not confirm ${type} for: ${unconfirmedHandles.join(", ")}`);
      }
      console.log(
        `Finished direct ${type}. confirmed=${summary.confirmed}, skipped=${summary.skipped}, unconfirmed=${summary.unconfirmed}`,
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
