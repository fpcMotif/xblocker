// X DOM vocabulary matched across content surfaces: the language-independent testid
// selectors and the localized block/mute menu labels used to classify a native ••• menu
// click. Every surface that used to inline these strings — author extraction, the reply
// rail's hover detection, the injected-console stylesheet, and the quick-block
// auto-confirm watcher — reads them from here so a selector can never drift on one
// surface while the others keep the old spelling. Selectors with a single consumer stay
// module-private in that consumer (e.g. the byline selectors in author.ts); this file
// hosts only the vocabulary shared across surfaces.
import type { DirectActionType } from "./x-api";

/** A genuine tweet/reply <article> (also X's Discover-more recommendation cards). */
export const TWEET_ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
/** The confirm button X shares across every confirmation sheet (block/mute/delete/
 *  unfollow/log out/…). Its text is localized, so this testid alone can never classify
 *  a sheet — the block/mute menu labels below carry the intent instead. */
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
