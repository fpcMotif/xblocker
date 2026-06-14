// One-click manual ("quick") block/mute for a single account. Two strategies live
// behind the VITE_QUICK_BLOCK_MODE flag (see docs/adr/0001-one-click-manual-block.md):
//
//   auto-confirm  -- watch for X's native confirmation sheet and auto-click confirm,
//                    scoped to block/mute sheets only. The default: it bypasses X's
//                    "Block @user?" dialog for the native ••• -> Block (and Mute) flow,
//                    whether the user gets there by mouse or keyboard, on every surface.
//                    Mounted once and never on a per-surface basis (see index.ts).
//   inline        -- the Cursor Console: per-reply Block/Mute/Whitelist buttons that
//                    call the direct internal API (blockTweet/muteTweet), no confirm.
//                    More robust (no dialog dependency) but adds its own buttons.
//   off           -- do nothing.
import {
  addToWhitelist,
  blockTweet,
  extractUsernameFromTweet,
  isReplyArticle,
  muteTweet,
  type DirectActionType,
} from "./actions";
import { createActionButton } from "./buttons";
import { detectTheme } from "./theme";
import { showToast } from "./toast";

export type QuickBlockMode = "inline" | "auto-confirm" | "off";

export const DEFAULT_QUICK_BLOCK_MODE: QuickBlockMode = "auto-confirm";

const CONSOLE_CLASS = "xb-console";

// X reuses the confirmationSheetConfirm testid across many sheets (block, delete,
// unfollow, log out, ...) AND localizes their text, so neither the testid nor the wording
// can classify a sheet reliably -- an English "block|mute" text match silently fails on a
// non-English UI (verified: a zh-Hant client shows "封鎖 @user"). Instead we only confirm a
// sheet that appears shortly after we observed the user trigger a block/mute, keyed off the
// language-independent menu-item testids. Delete/unfollow sheets are never auto-confirmed
// because they originate from different menu items.
//
// Safety: the armed intent is consumed on confirm and dropped the moment the user does
// anything else (cancel, open another menu, or any click that is not the block/mute item
// or our own confirm). Otherwise a mute that shows no sheet, or a cancelled block, could
// leave an intent armed that then auto-confirms a later destructive sheet (delete, log
// out). The short window is only a backstop for the rare no-intervening-click case.
const AUTO_CONFIRM_WINDOW_MS = 2000;

// X localizes its menu labels and does not put a stable testid on every menu item, so
// detect the Block/Mute item by testid first, then fall back to the menu item's accessible
// text in the locales we support (English + the zh-Hant/zh-Hans UIs). Matching is
// substring + case-insensitive against aria-label and text content.
const BLOCK_LABELS = ["block", "封鎖", "封锁", "屏蔽"];
const MUTE_LABELS = ["mute", "靜音", "静音"];

function intentFromClick(target: Element): DirectActionType | null {
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

/** Validate an arbitrary flag value, falling back to the default mode. */
export function normalizeQuickBlockMode(raw: unknown): QuickBlockMode {
  if (raw === "inline" || raw === "auto-confirm" || raw === "off") {
    return raw;
  }
  return DEFAULT_QUICK_BLOCK_MODE;
}

/** The build-time strategy from VITE_QUICK_BLOCK_MODE (same env convention as Convex). */
export function resolveQuickBlockMode(): QuickBlockMode {
  return normalizeQuickBlockMode(import.meta.env["VITE_QUICK_BLOCK_MODE"]);
}

export type QuickBlockOptions = {
  mode: QuickBlockMode;
  /** Fired after a successful single block/mute (e.g. to bump the rail's session count). */
  onActed?: (kind: DirectActionType) => void;
  /** Injectable clock for the auto-confirm window; defaults to performance.now(). */
  now?: () => number;
};

export class QuickBlock {
  private readonly mode: QuickBlockMode;
  private readonly onActed: (kind: DirectActionType) => void;
  private readonly now: () => number;
  private observer: MutationObserver | null = null;
  private pendingNativeAction: { kind: DirectActionType; at: number } | null = null;

  // Capture-phase so we record the intent before X tears the menu down. Keyed off the
  // testids, which are stable across locales (unlike the sheet text).
  private readonly nativeActionListener = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const intent = intentFromClick(target);
    if (intent) {
      this.pendingNativeAction = { kind: intent, at: this.now() };
    } else if (!target.closest('[data-testid="confirmationSheetConfirm"]')) {
      // Any other click -- cancelling the sheet, opening a different menu, or a
      // sheet-less mute followed by some unrelated action -- means the user moved on.
      // Drop the intent so it can never auto-confirm a later, foreign sheet (delete
      // post, log out, unfollow). Our own programmatic confirm click is excluded.
      this.pendingNativeAction = null;
    }
  };

  constructor(options: QuickBlockOptions) {
    this.mode = options.mode;
    this.onActed = options.onActed ?? (() => {});
    this.now = options.now ?? (() => performance.now());
  }

  mount(): void {
    if (this.mode === "off") {
      return;
    }
    this.observer = new MutationObserver(() => {
      this.scan();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    if (this.mode === "auto-confirm") {
      document.addEventListener("click", this.nativeActionListener, true);
    }
    this.scan();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    document.removeEventListener("click", this.nativeActionListener, true);
    for (const node of document.querySelectorAll(`.${CONSOLE_CLASS}`)) {
      node.remove();
    }
  }

  /** Observer entry point, also called directly in tests for determinism. */
  scan(): void {
    if (this.mode === "inline") {
      this.injectConsoles();
    } else if (this.mode === "auto-confirm") {
      this.tryAutoConfirm();
    }
  }

  private injectConsoles(): void {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (!isReplyArticle(article) || article.querySelector(`.${CONSOLE_CLASS}`)) {
        continue;
      }
      const username = extractUsernameFromTweet(article);
      if (!username) {
        continue;
      }
      // The console is positioned absolutely; give the reply a positioning context
      // without disturbing one X may already have set inline.
      if (article instanceof HTMLElement && !article.style.position) {
        article.style.position = "relative";
      }
      article.appendChild(this.createConsole(article, username));
    }
  }

  private createConsole(article: Element, username: string): HTMLDivElement {
    const console = document.createElement("div");
    console.className = `xb-root ${CONSOLE_CLASS}`;
    console.dataset.xbTheme = detectTheme();
    console.setAttribute("role", "group");
    console.setAttribute("aria-label", `XBlocker quick actions for @${username}`);

    console.append(
      createActionButton({
        action: "block",
        icon: "block",
        label: `Block @${username}`,
        onClick: () => this.act("block", article),
      }),
      createActionButton({
        action: "mute",
        icon: "mute",
        label: `Mute @${username}`,
        onClick: () => this.act("mute", article),
      }),
      createActionButton({
        action: "whitelist",
        icon: "whitelist",
        label: `Whitelist @${username}`,
        onClick: () => this.whitelistOnly(username),
      }),
    );

    // Stop clicks reaching X's article link, which would navigate to the tweet.
    console.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    return console;
  }

  private async act(kind: DirectActionType, article: Element): Promise<void> {
    const result = await (kind === "block" ? blockTweet(article) : muteTweet(article));

    if (result.status === "blocked" || result.status === "muted") {
      if (article instanceof HTMLElement) {
        article.dataset.xbBlocked = "true";
      }
      this.onActed(kind);
      showToast(`${kind === "block" ? "Blocked" : "Muted"} @${result.username}`, "success");
      return;
    }
    if (result.status === "skipped") {
      showToast(`@${result.username} is whitelisted`, "info");
      return;
    }
    // Surface failure on the button (busy -> error) and to the user.
    showToast(`Could not ${kind}. Stay signed in to X and retry.`, "warning");
    throw new Error(`Quick ${kind} failed.`);
  }

  private async whitelistOnly(username: string): Promise<void> {
    const result = await addToWhitelist(username);
    if (result === "added") {
      showToast(`Added @${username} to whitelist`, "success");
      return;
    }
    if (result === "exists") {
      showToast(`@${username} is already in the whitelist`, "warning");
      return;
    }
    showToast("Could not update the whitelist. Try again.", "warning");
    throw new Error("Whitelist update failed.");
  }

  private tryAutoConfirm(): void {
    const confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (!(confirm instanceof HTMLElement) || confirm.dataset.xbAutoConfirmed === "true") {
      return;
    }
    // Only confirm a sheet that follows a block/mute we just saw the user trigger.
    const pending = this.pendingNativeAction;
    if (!pending || this.now() - pending.at > AUTO_CONFIRM_WINDOW_MS) {
      return;
    }
    // Clear + mark before clicking so a re-entrant observer fire never double-confirms.
    this.pendingNativeAction = null;
    confirm.dataset.xbAutoConfirmed = "true";
    confirm.click();
  }
}
