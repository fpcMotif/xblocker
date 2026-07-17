import { addToWhitelist } from "../lib/whitelist-store";
import { extractUsernameFromTweet, getConversationReplies } from "./author";
import { createActionButton } from "./buttons";
import { blockTweet, muteTweet } from "./reply-actions";
import { detectTheme } from "./theme";
import { showToast } from "./toast";
import type { DirectActionType } from "./x-api";

export type CursorConsoleOptions = {
  onActed?: (kind: DirectActionType) => void;
};

const CONSOLE_CLASS = "xb-console";

export class CursorConsole {
  private readonly onActed: (kind: DirectActionType) => void;
  private observer: MutationObserver | null = null;

  constructor(options: CursorConsoleOptions = {}) {
    this.onActed = options.onActed ?? (() => {});
  }

  mount(): void {
    this.observer = new MutationObserver(() => {
      this.scan();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scan();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const node of document.querySelectorAll(`.${CONSOLE_CLASS}`)) {
      node.remove();
    }
  }

  private scan(): void {
    for (const article of getConversationReplies()) {
      if (article.querySelector(`.${CONSOLE_CLASS}`)) {
        continue;
      }

      const username = extractUsernameFromTweet(article);
      if (!username) {
        continue;
      }

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
}
