// The one authoritative home for X's DOM vocabulary the content surfaces match against:
// the language-independent testid selectors (the reply <article>, the shared
// confirmation-sheet confirm button) and the localized block/mute menu-item labels used
// to classify a native ••• menu click. Every surface that used to inline these strings —
// author extraction, the reply rail's hover detection, the injected-console stylesheet,
// and the quick-block auto-confirm watcher — reads them from here so a selector can never
// drift on one surface while the others keep the old spelling.
//
// The tweet-article, User-Name byline, and socialContext selectors were verified against a
// live zh-Hant x.com DOM (2026-06); the confirmationSheetConfirm testid is reused by X
// across many sheets (block, delete, unfollow, log out) and localizes its text, so the
// testid alone can never classify a sheet — that is why the block/mute menu LABELS live
// here beside it, keyed off the locale-stable menu-item testids first and the visible
// label only as a fallback.
//
// Deferred on purpose: the menu-automation adapter that todo.md's not-interested / hide
// actions will need consumes this same vocabulary, but is NOT built yet — its menu-item
// selectors ("not interested" and its confirmation flow) have not been live-verified, and
// shipping blind DOM automation would be untested destructive behavior. This deferral is
// what replaces the earlier "actOnUser gateway" (C3) work item: when a live-verify session
// pins those selectors, the adapter slots in here alongside a router in actions.ts.
import type { DirectActionType } from "./x-api";

/** A genuine tweet/reply <article> (also X's Discover-more recommendation cards). */
export const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
/** The confirm button X shares across every confirmation sheet (block/mute/delete/…). */
export const CONFIRMATION_SHEET_CONFIRM_SELECTOR = '[data-testid="confirmationSheetConfirm"]';

// X localizes its menu labels and does not put a stable testid on every menu item, so
// detect the Block/Mute item by testid first, then fall back to the menu item's accessible
// text in the locales we support (English + the zh-Hant/zh-Hans UIs). Matching is
// substring + case-insensitive against aria-label and text content.
const BLOCK_LABELS = ["block", "封鎖", "封锁", "屏蔽"];
const MUTE_LABELS = ["mute", "靜音", "静音"];

/** Classify a native ••• menu click as a block/mute intent (or neither), by the
 *  locale-stable menu-item testids first, then the localized visible label. */
export function intentFromClick(target: Element): DirectActionType | null {
  if (target.closest('[data-testid="block"]')) {
    return "block";
  }
  if (target.closest('[data-testid="mute"]')) {
    return "mute";
  }
  const item = target.closest('[role="menuitem"]');
  if (!item) {
    return null;
  }
  const label = `${item.getAttribute("aria-label") ?? ""} ${item.textContent ?? ""}`.toLowerCase();
  if (BLOCK_LABELS.some((term) => label.includes(term))) {
    return "block";
  }
  if (MUTE_LABELS.some((term) => label.includes(term))) {
    return "mute";
  }
  return null;
}
