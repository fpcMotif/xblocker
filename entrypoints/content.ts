import { defineContentScript } from "wxt/utils/define-content-script";

type ToastType = "info" | "success" | "warning";
type ThemeActionColor = "primary" | "success" | "warning" | "danger";
type ThemeColor = ThemeActionColor | "background" | "surface" | "border" | "text" | "textSecondary";
type Theme = {
  isDark: boolean;
  colors: Record<ThemeColor, string>;
};
type ReplyActionType = "block" | "mute" | "whitelist";
type ActionIconType = ReplyActionType | "settings" | "loading";
type ReplyActionConfig = {
  type: ReplyActionType;
  color: ThemeActionColor;
  text: string;
  action: () => Promise<void> | void;
};
type BlockTweetResult =
  | { status: "blocked"; username: string }
  | { status: "skipped"; username: string }
  | { status: "failed"; username?: string; reason?: string; error?: unknown };
type DirectBlockRequest = {
  url: string;
  options: RequestInit & {
    method: "POST";
    credentials: "include";
    headers: Record<string, string>;
    body: string;
  };
};
type XBlockerTestHooks = {
  addButtons: () => void;
  addToWhitelist: (username: string) => void;
  blockFirst20CommentTweets: () => Promise<void>;
  blockTweet: (tweetArticle: Element) => Promise<BlockTweetResult>;
  blockUserDirectly: (username: string) => Promise<Response>;
  checkPageAndAddButton: () => void;
  createActionIcon: (type: ActionIconType, size?: number, color?: string) => SVGSVGElement;
  createDirectBlockRequest: (username: string) => DirectBlockRequest;
  createReplyActionButton: (config: ReplyActionConfig, theme: Theme) => HTMLButtonElement;
  detectTheme: () => Theme;
  extractUsernameFromTweet: (tweetArticle: Element) => string | null;
  getCookieValue: (name: string) => string;
  getWhitelist: (callback: (whitelist: string[]) => void) => void;
  initializeXBlocker: () => void;
  isTweetPageUrl: (url: string) => boolean;
  muteFirst50CommentTweets: () => Promise<void>;
  muteTweet: (tweetArticle: Element) => Promise<void>;
  normalizeUsername: (value: string | null | undefined) => string | null;
  observeThemeChanges: () => MutationObserver;
  runContentScript: () => void;
  saveWhitelist: (whitelist: string[]) => void;
  showToast: (message: string, type?: ToastType) => void;
  showWhitelistModal: () => void;
  waitFor: (ms: number) => Promise<void>;
};

declare global {
  var __XB_TEST__: boolean | undefined;
  var __xblockerTestHooks: XBlockerTestHooks | undefined;
}

const X_AUTH_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const DIRECT_BLOCK_DELAY_MS = 250;
const TWEET_PAGE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);
const LOCAL_TEST_PAGE_PATTERN = new RegExp(String.raw`^https?://(localhost|127\.0\.0\.1)`);
const TIMELINE_URL_PATTERN = new RegExp(String.raw`https?://(www\.)?x\.com/i/timeline`);
const PROFILE_URL_PATTERN = new RegExp(String.raw`^https?://(www\.)?x\.com/[^/]+/?$`);
const RESERVED_X_PATHS = new Set<string>([
  "home",
  "i",
  "intent",
  "messages",
  "notifications",
  "search",
  "settings",
  "share",
]);

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCookieValue(name: string): string {
  return (
    document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}

function isTweetPageUrl(url: string): boolean {
  const isLocalTestPage =
    typeof globalThis !== "undefined" &&
    globalThis.__XB_TEST__ &&
    LOCAL_TEST_PAGE_PATTERN.test(url);

  return TWEET_PAGE_URL_PATTERN.test(url) || !!isLocalTestPage;
}

function normalizeUsername(value: string | null | undefined): string | null {
  const username = value?.replace(/^@/, "").trim();
  if (!username || RESERVED_X_PATHS.has(username.toLowerCase())) {
    return null;
  }

  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : null;
}

function extractUsernameFromTweet(tweetArticle: Element): string | null {
  const links = tweetArticle.querySelectorAll('a[href^="/"][role="link"]');
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const firstPathPart = href.split("?")[0]?.split("/").find(Boolean) || "";
    const username = normalizeUsername(firstPathPart);
    if (username) {
      return username;
    }
  }

  return null;
}

function getXApiBaseUrl(): string {
  return window.location.hostname === "twitter.com"
    ? "https://api.twitter.com"
    : "https://api.x.com";
}

function createDirectBlockRequest(username: string): DirectBlockRequest {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error("Missing valid username for direct block.");
  }

  const csrfToken = getCookieValue("ct0");
  if (!csrfToken) {
    throw new Error("Missing X CSRF token; open x.com while signed in and try again.");
  }

  return {
    url: `${getXApiBaseUrl()}/1.1/blocks/create.json`,
    options: {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${X_AUTH_BEARER_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Csrf-Token": csrfToken,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
      },
      body: new URLSearchParams({ screen_name: normalizedUsername }).toString(),
    },
  };
}

async function blockUserDirectly(username: string): Promise<Response> {
  const request = createDirectBlockRequest(username);
  const response = await fetch(request.url, request.options);
  if (!response.ok) {
    throw new Error(`Direct block failed with HTTP ${response.status}.`);
  }
  return response;
}

async function blockFirst20CommentTweets(): Promise<void> {
  if (!isTweetPageUrl(window.location.href)) {
    console.log("Not on a tweet page. Exiting.");
    return;
  }

  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
  const commentTweets = Array.from(tweetArticles).slice(1);
  const first20Comments = commentTweets.slice(0, 50);

  const progressBar = document.querySelector<HTMLElement>(".xb-progress-bar");
  const total = first20Comments.length;
  let blockedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const [index, tweetArticle] of first20Comments.entries()) {
    const result = await blockTweet(tweetArticle);
    if (result?.status === "blocked") {
      blockedCount++;
    } else if (result?.status === "skipped") {
      skippedCount++;
    } else if (result?.status === "failed") {
      failedCount++;
    }
    if (progressBar) {
      progressBar.style.width = `${((index + 1) / total) * 100}%`;
    }
    await waitFor(DIRECT_BLOCK_DELAY_MS);
  }

  if (blockedCount > 0) {
    showToast(
      `Blocked ${blockedCount} replies directly${skippedCount ? `, skipped ${skippedCount}` : ""}`,
      "success",
    );
  } else if (failedCount > 0) {
    showToast("Direct block failed. Please stay signed in to X and retry.", "warning");
  }
  console.log(
    `Finished direct blocking. blocked=${blockedCount}, skipped=${skippedCount}, failed=${failedCount}`,
  );
}

function getWhitelist(callback: (whitelist: string[]) => void): void {
  chrome.storage.local.get("whitelist", (result) => {
    const whitelist = Array.isArray(result?.whitelist) ? result.whitelist : [];
    callback(whitelist);
  });
}

function saveWhitelist(whitelist: string[]): void {
  chrome.storage.local.set({ whitelist: whitelist }, () => {
    console.log("Whitelist saved");
  });
}

function addToWhitelist(username: string): void {
  getWhitelist((whitelist) => {
    if (!whitelist.includes(username)) {
      whitelist.push(username);
      saveWhitelist(whitelist);
      showToast(`✅ Added @${username} to whitelist`, "success");
    } else {
      showToast(`⚠️ @${username} is already in the whitelist`, "warning");
    }
  });
}

function showToast(message: string, type: ToastType = "info"): void {
  const theme = detectTheme();
  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  const toastColor =
    type === "success"
      ? theme.colors.success
      : type === "warning"
        ? theme.colors.warning
        : theme.colors.primary;

  toast.style.cssText = `
		position: fixed;
		top: 24px;
		right: 24px;
		z-index: 10002;
		background: linear-gradient(135deg, ${toastColor}, ${toastColor}dd);
		color: white;
		padding: 16px 20px;
		border-radius: 12px;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		font-size: 14px;
		font-weight: 500;
		box-shadow: 0 8px 25px rgba(0, 0, 0, ${theme.isDark ? "0.4" : "0.2"});
		border: 1px solid ${theme.colors.border};
		backdrop-filter: blur(12px);
		animation: slideInToast 0.3s ease-out;
		max-width: 300px;
		word-wrap: break-word;
	`;

  // Add toast animation if not already added
  const existingStyle = document.getElementById("xblocker-styles");
  if (existingStyle && !existingStyle.textContent.includes("slideInToast")) {
    existingStyle.textContent += `
			@keyframes slideInToast {
				from { transform: translateX(100%); opacity: 0; }
				to { transform: translateX(0); opacity: 1; }
			}
			@keyframes slideOutToast {
				from { transform: translateX(0); opacity: 1; }
				to { transform: translateX(100%); opacity: 0; }
			}
		`;
  }

  toast.textContent = message;
  document.body.appendChild(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = "slideOutToast 0.3s ease-in forwards";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  }, 3000);

  // Click to dismiss
  toast.addEventListener("click", () => {
    toast.style.animation = "slideOutToast 0.3s ease-in forwards";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300);
  });
}

// Modify the blockTweet function to skip whitelisted users
async function blockTweet(tweetArticle: Element): Promise<BlockTweetResult> {
  const username = extractUsernameFromTweet(tweetArticle);

  return new Promise((resolve) => {
    getWhitelist(async (whitelist) => {
      if (username && whitelist.includes(username)) {
        console.log(`Skipping @${username}, as they are in the whitelist.`);
        resolve({ status: "skipped", username });
        return;
      }

      if (!username) {
        console.log("Username not found for a comment tweet.");
        resolve({ status: "failed", reason: "missing-username" });
        return;
      }

      try {
        await blockUserDirectly(username);
        resolve({ status: "blocked", username });
      } catch (error) {
        console.warn(`Direct block failed for @${username}:`, error);
        resolve({ status: "failed", username, error });
      }
    });
  });
}

async function muteFirst50CommentTweets(): Promise<void> {
  if (!isTweetPageUrl(window.location.href)) {
    console.log("Not on a tweet page. Exiting.");
    return;
  }

  const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
  const commentTweets = Array.from(tweetArticles).slice(1);
  const first50Comments = commentTweets.slice(0, 50);

  const progressBar = document.querySelector<HTMLElement>(".xb-progress-bar");
  const total = first50Comments.length;

  for (const [index, tweetArticle] of first50Comments.entries()) {
    await muteTweet(tweetArticle);
    if (progressBar) {
      progressBar.style.width = `${((index + 1) / total) * 100}%`;
    }
  }

  console.log("Finished muting the first 50 comment tweets.");
}

async function muteTweet(tweetArticle: Element): Promise<void> {
  const userLink = tweetArticle.querySelector('a[href^="/"][role="link"]');
  let username: string | null = null;
  if (userLink) {
    const urlParts = (userLink.getAttribute("href") || "").split("/");
    username = normalizeUsername(urlParts[1]);
  }

  return new Promise((resolve) => {
    getWhitelist(async (whitelist) => {
      if (username && whitelist.includes(username)) {
        console.log(`Skipping @${username}, as they are in the whitelist.`);
        resolve();
        return;
      }

      // Find the "More" button
      const moreButton = tweetArticle.querySelector<HTMLElement>('[aria-label="More"]');

      if (moreButton) {
        // Simulate click on the "More" menu
        moreButton.click();

        // Wait for the menu to appear
        await new Promise((r) => setTimeout(r, 500));

        // Find the "Mute @username" menu item
        const muteItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
          .toReversed()
          .find((item) => item.innerText.trim() === `Mute @${username}`);

        if (muteItem) {
          // Simulate click on "Mute @username"
          muteItem.click();

          // Wait for the confirmation modal to appear
          await new Promise((r) => setTimeout(r, 500));

          // Find and click the "Mute" button in the modal
          const confirmButton = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="confirmationSheetConfirm"]'),
          ).at(-1);
          if (confirmButton) {
            confirmButton.click();
          }
        } else {
          console.log("Mute option not found.");
        }

        // Wait before proceeding to the next tweet
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.log("More button not found for a comment tweet.");
      }
      resolve();
    });
  });
}

function detectTheme(): Theme {
  // Check for dark mode indicators in X.com
  const html = document.documentElement;
  const body = document.body;

  // X.com uses these classes for theme detection
  const isDark =
    html.style.colorScheme === "dark" ||
    body.style.backgroundColor === "rgb(0, 0, 0)" ||
    getComputedStyle(body).backgroundColor === "rgb(0, 0, 0)" ||
    document.querySelector('[data-theme="dark"]') ||
    document.querySelector('meta[name="theme-color"][content="#000000"]');

  return {
    isDark: !!isDark,
    colors: isDark
      ? {
          primary: "#1d9bf0", // X.com blue
          success: "#00ba7c", // Green
          warning: "#ffad1f", // Orange
          danger: "#f4212e", // Red
          background: "rgba(0, 0, 0, 0.8)",
          surface: "rgba(255, 255, 255, 0.03)",
          border: "rgba(255, 255, 255, 0.08)",
          text: "#e7e9ea",
          textSecondary: "#71767b",
        }
      : {
          primary: "#1d9bf0", // X.com blue
          success: "#00ba7c", // Green
          warning: "#ffad1f", // Orange
          danger: "#f4212e", // Red
          background: "rgba(255, 255, 255, 0.9)",
          surface: "rgba(0, 0, 0, 0.03)",
          border: "rgba(0, 0, 0, 0.08)",
          text: "#0f1419",
          textSecondary: "#536471",
        },
  };
}

function createActionIcon(type: ActionIconType, size = 20, color = "currentColor"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.style.cssText = `
		display: inline-block;
		vertical-align: middle;
		flex-shrink: 0;
		pointer-events: none;
	`;

  let path = "";
  switch (type) {
    case "block":
      path = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none"/>
			<path d="M9 9l6 6m0-6l-6 6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
      break;
    case "mute":
      path = `<path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
			<path d="M23 9l-6 6M17 9l6 6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
      break;
    case "whitelist":
      path = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none"/>
			<path d="M9 12l2 2 4-4" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    case "settings":
      path = `<circle cx="12" cy="12" r="3" stroke="${color}" stroke-width="2" fill="none"/>
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.6-1.2H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.56.74.94 1.33 1H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
      break;
    case "loading":
      svg.innerHTML = `<circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="31.416" stroke-dashoffset="31.416">
				<animate attributeName="stroke-dasharray" dur="1.5s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
				<animate attributeName="stroke-dashoffset" dur="1.5s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
			</circle>`;
      return svg;
  }

  svg.innerHTML = path;
  return svg;
}

function createReplyActionButton(config: ReplyActionConfig, theme: Theme): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `xb-reply-action xb-reply-action-${config.type}`;
  button.setAttribute("aria-label", config.text);
  button.dataset.action = config.type;

  const isDestructive = config.type === "block";
  const textColor = isDestructive ? "#ffffff" : theme.colors[config.color];
  const surface = isDestructive ? theme.colors.danger : theme.colors.surface;
  const border = isDestructive ? "rgba(244, 33, 46, 0.65)" : theme.colors.border;

  button.style.cssText = `
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 34px;
		padding: 0 11px;
		background: ${surface};
		border-radius: 8px;
		color: ${textColor};
		font-size: 13px;
		line-height: 1;
		font-weight: 700;
		cursor: pointer;
		border: 1px solid ${border};
		box-shadow: none;
		transition:
			background 0.16s ease,
			border-color 0.16s ease,
			color 0.16s ease,
			transform 0.16s ease;
		min-width: 0;
		position: relative;
		white-space: nowrap;
		font-family: inherit;
	`;

  const icon = createActionIcon(config.type, 15, "currentColor");

  const label = document.createElement("span");
  label.textContent = config.text;

  button.appendChild(icon);
  button.appendChild(label);

  button.addEventListener("mouseenter", () => {
    button.style.transform = "translateY(-1px)";
    button.style.borderColor = theme.colors[config.color];
    if (!isDestructive) {
      button.style.background = theme.isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)";
    }
  });

  button.addEventListener("mouseleave", () => {
    button.style.transform = "translateY(0)";
    button.style.borderColor = border;
    button.style.background = surface;
  });

  button.addEventListener("click", async () => {
    await executeReplyAction(button, config, icon, label);
  });

  return button;
}

async function executeReplyAction(
  button: HTMLButtonElement,
  config: ReplyActionConfig,
  icon: SVGSVGElement,
  label: HTMLSpanElement,
): Promise<void> {
  const originalText = label.textContent;
  const originalIcon = createActionIcon(config.type, 15, "currentColor");

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.style.opacity = "0.8";

  const loadingIcon = createActionIcon("loading", 15, "currentColor");
  button.replaceChild(loadingIcon, icon);
  label.textContent = "Working";

  try {
    await config.action();

    const successIcon = createActionIcon("whitelist", 15, "currentColor");
    button.replaceChild(successIcon, loadingIcon);
    label.textContent = "Done";

    setTimeout(() => {
      button.replaceChild(originalIcon, successIcon);
      label.textContent = originalText;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.style.opacity = "1";
    }, 1600);
  } catch {
    const errorIcon = createActionIcon("block", 15, "currentColor");
    button.replaceChild(errorIcon, loadingIcon);
    label.textContent = "Error";

    setTimeout(() => {
      button.replaceChild(originalIcon, errorIcon);
      label.textContent = originalText;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.style.opacity = "1";
    }, 1600);
  }
}

function addButtons(): void {
  for (const id of ["xblocker-reply-action-bar", "xblocker-dashboard", "xblocker-buttons"]) {
    document.getElementById(id)?.remove();
  }

  const theme = detectTheme();

  const actionBar = document.createElement("div");
  actionBar.id = "xblocker-reply-action-bar";
  actionBar.dataset.xbSurface = "reply-action-bar";
  actionBar.setAttribute("role", "toolbar");
  actionBar.setAttribute("aria-label", "XBlocker reply actions");
  actionBar.style.cssText = `
		position: fixed;
		right: 20px;
		bottom: 20px;
		z-index: 10000;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
		box-sizing: border-box;
		width: max-content;
		max-width: calc(100vw - 32px);
		padding: 8px 8px 10px;
		background: ${theme.colors.background};
		border: 1px solid ${theme.colors.border};
		border-radius: 8px;
		box-shadow:
			0 14px 34px rgba(0, 0, 0, ${theme.isDark ? "0.42" : "0.16"}),
			0 2px 8px rgba(0, 0, 0, ${theme.isDark ? "0.26" : "0.08"});
		backdrop-filter: blur(18px);
		pointer-events: auto;
	`;

  const status = document.createElement("div");
  status.className = "xb-reply-action-status";
  status.textContent = "0 blocked";
  status.style.cssText = `
		display: flex;
		align-items: center;
		height: 34px;
		padding: 0 10px;
		border-radius: 8px;
		background: ${theme.colors.surface};
		color: ${theme.colors.textSecondary};
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
	`;

  const actions = document.createElement("div");
  actions.className = "xb-reply-action-buttons";
  actions.style.cssText = `
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex: 1 1 238px;
		flex-wrap: wrap;
		gap: 6px;
		min-width: 0;
	`;

  const buttonConfigs: ReplyActionConfig[] = [
    { type: "block", color: "danger", text: "Block replies", action: blockFirst20CommentTweets },
    { type: "mute", color: "warning", text: "Mute replies", action: muteFirst50CommentTweets },
    { type: "whitelist", color: "success", text: "Whitelist", action: () => showWhitelistModal() },
  ];

  buttonConfigs.forEach((config) => {
    actions.appendChild(createReplyActionButton(config, theme));
  });

  const progress = document.createElement("div");
  progress.className = "xb-progress";
  progress.style.cssText = `
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 4px;
		height: 2px;
		background: ${theme.colors.surface};
		border-radius: 999px;
		overflow: hidden;
	`;

  const progressBar = document.createElement("div");
  progressBar.className = "xb-progress-bar";
  progressBar.style.cssText = `
		width: 0%;
		height: 100%;
		background: ${theme.colors.primary};
		transition: width 0.24s ease;
	`;
  progress.appendChild(progressBar);

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "xb-reply-action-settings";
  settingsButton.setAttribute("aria-label", "Open XBlocker settings");
  settingsButton.style.cssText = `
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border-radius: 8px;
		border: 1px solid ${theme.colors.border};
		background: ${theme.colors.surface};
		color: ${theme.colors.textSecondary};
		cursor: pointer;
		font-family: inherit;
	`;
  settingsButton.appendChild(createActionIcon("settings", 15, "currentColor"));
  settingsButton.addEventListener("click", () => {
    showToast("Use the XBlocker extension popup for settings.", "info");
  });

  actionBar.appendChild(status);
  actionBar.appendChild(actions);
  actionBar.appendChild(settingsButton);
  actionBar.appendChild(progress);
  document.body.appendChild(actionBar);

  console.log("XBlocker Reply Action Bar initialized");
}

function showWhitelistModal(): void {
  // Remove existing modal if it exists
  const existingModal = document.getElementById("xblocker-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const theme = detectTheme();
  const modal = document.createElement("div");
  modal.id = "xblocker-modal";
  modal.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, ${theme.isDark ? "0.7" : "0.5"});
		z-index: 10001;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(8px);
		animation: fadeIn 0.2s ease-out;
	`;

  const modalContent = document.createElement("div");
  modalContent.style.cssText = `
		background: ${theme.colors.background};
		border-radius: 16px;
		padding: 24px;
		width: 90%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, ${theme.isDark ? "0.5" : "0.3"});
		border: 1px solid ${theme.colors.border};
		color: ${theme.colors.text};
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		animation: slideInModal 0.3s ease-out;
	`;

  // Add modal animations to existing styles
  const existingStyle = document.getElementById("xblocker-styles");
  if (existingStyle && !existingStyle.textContent.includes("fadeIn")) {
    existingStyle.textContent += `
			@keyframes fadeIn {
				from { opacity: 0; }
				to { opacity: 1; }
			}
			@keyframes slideInModal {
				from { transform: translateY(-20px) scale(0.95); opacity: 0; }
				to { transform: translateY(0) scale(1); opacity: 1; }
			}
		`;
  }

  modalContent.innerHTML = `
		<h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: ${theme.colors.text};">Add User to Whitelist</h3>
		<p id="whitelist-modal-desc" style="margin: 0 0 16px 0; color: ${theme.colors.textSecondary}; font-size: 14px;">Enter a username to prevent them from being blocked or muted</p>
		<input type="text" id="username-input" placeholder="Enter username (without @)" aria-label="Username to whitelist" aria-describedby="whitelist-modal-desc"
			style="width: 100%; padding: 12px; border: 1px solid ${theme.colors.border}; 
			border-radius: 8px; background: ${theme.colors.surface}; color: ${theme.colors.text}; 
			font-size: 14px; margin-bottom: 16px; box-sizing: border-box;
			outline: none; transition: border-color 0.2s ease;">
		<div style="display: flex; gap: 12px; justify-content: flex-end;">
			<button id="cancel-btn" style="padding: 8px 16px; background: transparent; 
				color: ${theme.colors.textSecondary}; border: 1px solid ${theme.colors.border}; border-radius: 6px; 
				cursor: pointer; font-size: 14px; transition: all 0.2s ease;">Cancel</button>
			<button id="add-btn" style="padding: 8px 16px; background: linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd); 
				color: white; border: none; border-radius: 6px; cursor: pointer; 
				font-size: 14px; font-weight: 600; transition: all 0.2s ease;">Add to Whitelist</button>
		</div>
	`;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  const input = modal.querySelector<HTMLInputElement>("#username-input")!;
  const cancelBtn = modal.querySelector<HTMLButtonElement>("#cancel-btn")!;
  const addBtn = modal.querySelector<HTMLButtonElement>("#add-btn")!;

  // Focus input
  input.focus();

  // Style input focus
  input.addEventListener("focus", () => {
    input.style.borderColor = theme.colors.success;
  });
  input.addEventListener("blur", () => {
    input.style.borderColor = theme.colors.border;
  });

  // Button hover effects
  cancelBtn.addEventListener("mouseenter", () => {
    cancelBtn.style.background = theme.colors.surface;
    cancelBtn.style.color = theme.colors.text;
  });
  cancelBtn.addEventListener("mouseleave", () => {
    cancelBtn.style.background = "transparent";
    cancelBtn.style.color = theme.colors.textSecondary;
  });

  addBtn.addEventListener("mouseenter", () => {
    addBtn.style.transform = "translateY(-1px)";
    addBtn.style.boxShadow = `0 4px 12px ${theme.colors.success}30`;
    addBtn.style.background = `linear-gradient(135deg, ${theme.colors.success}ee, ${theme.colors.success}cc)`;
  });
  addBtn.addEventListener("mouseleave", () => {
    addBtn.style.transform = "translateY(0)";
    addBtn.style.boxShadow = "none";
    addBtn.style.background = `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`;
  });

  // Event handlers
  const closeModal = () => modal.remove();

  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  addBtn.addEventListener("click", () => {
    const username = input.value.trim();
    if (username) {
      addToWhitelist(username);
      closeModal();
    }
  });

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const username = input.value.trim();
      if (username) {
        addToWhitelist(username);
        closeModal();
      }
    } else if (e.key === "Escape") {
      closeModal();
    }
  });

  // Close on escape key
  document.addEventListener("keydown", function escapeHandler(e) {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escapeHandler);
    }
  });
}

// Theme change observer
function observeThemeChanges(): MutationObserver {
  const observer = new MutationObserver(() => {
    // Check if theme has changed and update buttons accordingly
    const existingContainer = document.getElementById("xblocker-dashboard");
    if (existingContainer) {
      // Refresh buttons with new theme
      setTimeout(() => {
        addButtons();
      }, 100);
    }
  });

  // Observe changes to document attributes that might indicate theme changes
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-theme"],
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["style", "class", "data-theme"],
  });

  return observer;
}

// Update checkPageAndAddButton function
function checkPageAndAddButton(): void {
  const url = window.location.href;

  if (TIMELINE_URL_PATTERN.test(url)) {
    // Do not add buttons or run code on the timeline page
    console.log("On timeline page. Exiting.");
    return;
  }

  // Add buttons on tweet pages and user feed pages
  if (TWEET_PAGE_URL_PATTERN.test(url) || PROFILE_URL_PATTERN.test(url)) {
    addButtons();
    // Start theme observation
    observeThemeChanges();
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

function isTestMode(): boolean {
  return typeof globalThis !== "undefined" && !!globalThis.__XB_TEST__;
}

function runContentScript(): void {
  if (!isTestMode()) {
    initializeXBlocker();
  }
}

const isXBlockerTestMode = isTestMode();

if (isXBlockerTestMode) {
  globalThis.__xblockerTestHooks = {
    addButtons,
    addToWhitelist,
    blockFirst20CommentTweets,
    blockTweet,
    blockUserDirectly,
    checkPageAndAddButton,
    createActionIcon,
    createDirectBlockRequest,
    createReplyActionButton,
    detectTheme,
    extractUsernameFromTweet,
    getCookieValue,
    getWhitelist,
    initializeXBlocker,
    isTweetPageUrl,
    muteFirst50CommentTweets,
    muteTweet,
    normalizeUsername,
    observeThemeChanges,
    runContentScript,
    saveWhitelist,
    showToast,
    showWhitelistModal,
    waitFor,
  };
}

export default defineContentScript({
  matches: ["https://x.com/*"],
  main: runContentScript,
});
