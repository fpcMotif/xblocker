// Catalog: QB-* (module-level one-click manual block: Cursor Console, scoped native
// auto-confirm, the mode flag, the service factory, and ContentSession wiring).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createQuickBlockService,
  type CreateQuickBlockServiceOptions,
  type QuickBlockService,
} from "../../entrypoints/content/create-quick-block-service.ts";
import { ContentSession } from "../../entrypoints/content/content-session.ts";
import { CursorConsole } from "../../entrypoints/content/cursor-console.ts";
import {
  DEFAULT_QUICK_BLOCK_MODE,
  normalizeQuickBlockMode,
  resolveQuickBlockMode,
} from "../../entrypoints/content/quick-block-mode.ts";
import { NativeAutoConfirm } from "../../entrypoints/content/native-auto-confirm.ts";
import { ReplyRail } from "../../entrypoints/content/rail.ts";
import {
  createAnonymousTweetArticle,
  createTweetArticle,
  installFetchStub,
  populateTweetPage,
} from "../helpers/content-dom.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";
import { installManualTimers, settleMicrotasks } from "../helpers/timers.ts";

// Mirrors AUTO_CONFIRM_WINDOW_MS in native-auto-confirm.ts (the sheet-watch expiry).
const AUTO_CONFIRM_WINDOW = 2000;

async function settle(): Promise<void> {
  await settleMicrotasks();
}

function consoleButton(root: ParentNode, action: string): HTMLButtonElement {
  const button = root.querySelector(`.xb-console .xb-btn[data-action="${action}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`expected a ${action} button in the console`);
  }
  return button;
}

function waitForButtonState(
  button: HTMLButtonElement,
  expected: "success" | "error",
): Promise<void> {
  if (button.dataset.state === expected) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (button.dataset.state === expected) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(button, { attributes: true, attributeFilter: ["data-state"] });
  });
}

/** A "main tweet + one reply" page; returns the reply article. */
function pageWithReply(username: string): HTMLElement {
  const [reply] = populateTweetPage([username]);
  if (!reply) {
    throw new Error("expected a reply article");
  }
  return reply;
}

/** Build X's native confirmation sheet (text is intentionally irrelevant to the logic). */
function buildConfirmSheet(): { confirm: HTMLButtonElement; clicks: () => number } {
  const dialog = document.createElement("div");
  dialog.setAttribute("data-testid", "confirmationSheetDialog");
  const confirm = document.createElement("button");
  confirm.setAttribute("data-testid", "confirmationSheetConfirm");
  let count = 0;
  confirm.addEventListener("click", () => {
    count += 1;
  });
  dialog.appendChild(confirm);
  document.body.appendChild(dialog);
  return { confirm, clicks: () => count };
}

/** Simulate the user clicking a native menu item, identified by its (locale-stable) testid. */
function clickMenuItem(testid: string): void {
  const item = document.createElement("div");
  item.setAttribute("data-testid", testid);
  document.body.appendChild(item);
  item.click();
}

/** Simulate a localized menu item with no testid (role + visible label only). */
function clickLocalizedMenuItem(label: string): void {
  const item = document.createElement("div");
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  document.body.appendChild(item);
  item.click();
}

beforeEach(() => {
  resetTestEnvironment();
  setDocumentCookie("ct0=csrf-token");
});

describe("quick-block mode resolution", () => {
  test("QB-01 normalizes the three valid modes verbatim", () => {
    expect(normalizeQuickBlockMode("inline")).toBe("inline");
    expect(normalizeQuickBlockMode("auto-confirm")).toBe("auto-confirm");
    expect(normalizeQuickBlockMode("off")).toBe("off");
  });

  test("QB-02 falls back to the default for unknown or non-string values", () => {
    expect(normalizeQuickBlockMode("bogus")).toBe(DEFAULT_QUICK_BLOCK_MODE);
    expect(normalizeQuickBlockMode(undefined)).toBe(DEFAULT_QUICK_BLOCK_MODE);
    expect(normalizeQuickBlockMode(42)).toBe(DEFAULT_QUICK_BLOCK_MODE);
    expect(DEFAULT_QUICK_BLOCK_MODE).toBe("auto-confirm");
  });

  test("QB-03 resolveQuickBlockMode reads the env flag (unset -> default)", () => {
    expect(resolveQuickBlockMode()).toBe("auto-confirm");
  });
});

describe("inline Cursor Console injection", () => {
  let qb: QuickBlockService | null = null;

  afterEach(() => {
    qb?.destroy();
    qb = null;
  });

  test("QB-10 injects a console only into replies, never the main tweet", async () => {
    const reply = pageWithReply("spammer");
    const main = document.querySelectorAll('article[data-testid="tweet"]')[0];

    qb = createQuickBlockService({ mode: "inline" });
    qb.mount();
    await settle();

    expect(reply.querySelectorAll(".xb-console")).toHaveLength(1);
    expect(main?.querySelector(".xb-console")).toBeNull();
    expect(consoleButton(reply, "block").getAttribute("aria-label")).toBe("Block @spammer");
  });

  test("QB-11 gives the reply a positioning context and is idempotent across mutations", async () => {
    const reply = pageWithReply("spammer");

    qb = new CursorConsole();
    qb.mount();
    document.body.append(document.createElement("div"), document.createElement("div"));
    await settle();

    expect(reply.style.position).toBe("relative");
    expect(reply.querySelectorAll(".xb-console")).toHaveLength(1);
  });

  test("QB-12 skips a reply that has no resolvable author", async () => {
    createTweetArticle("thread_author");
    document.body.appendChild(createTweetArticle("thread_author").tweetArticle);
    const anonymous = createAnonymousTweetArticle();
    document.body.appendChild(anonymous);

    qb = new CursorConsole();
    qb.mount();
    await settle();

    expect(anonymous.querySelector(".xb-console")).toBeNull();
  });

  test("QB-13 one click blocks the reply author, veils the reply, and toasts", async () => {
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    qb = new CursorConsole();
    qb.mount();
    await settle();
    const button = consoleButton(reply, "block");
    const acted = waitForButtonState(button, "success");
    button.click();
    await acted;
    stub.uninstall();

    expect(stub.calls.some((call) => call.url.includes("/blocks/create.json"))).toBe(true);
    expect(reply.dataset.xbBlocked).toBe("true");
    expect(document.querySelector('.xb-toast[data-type="success"]')).not.toBeNull();
  });

  test("QB-14 one click mutes the reply author", async () => {
    const reply = pageWithReply("noisy");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    qb = new CursorConsole();
    qb.mount();
    await settle();
    const button = consoleButton(reply, "mute");
    const acted = waitForButtonState(button, "success");
    button.click();
    await acted;
    stub.uninstall();

    expect(stub.calls.some((call) => call.url.includes("/mutes/users/create.json"))).toBe(true);
    expect(reply.dataset.xbBlocked).toBe("true");
  });

  test("QB-15 a whitelisted author is skipped, not blocked", async () => {
    storageFake.data["whitelist"] = ["spammer"];
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    qb = new CursorConsole();
    qb.mount();
    await settle();
    const button = consoleButton(reply, "block");
    const acted = waitForButtonState(button, "success");
    button.click();
    await acted;
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
    expect(document.querySelector('.xb-toast[data-type="info"]')).not.toBeNull();
  });

  test("QB-16 a failed block surfaces the button error state and does not veil", async () => {
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: false, status: 500 }));

    qb = new CursorConsole();
    qb.mount();
    await settle();
    const button = consoleButton(reply, "block");
    const acted = waitForButtonState(button, "error");
    button.click();
    await acted;
    stub.uninstall();

    expect(button.dataset.state).toBe("error");
    expect(reply.dataset.xbBlocked).toBeUndefined();
    expect(document.querySelector('.xb-toast[data-type="warning"]')).not.toBeNull();
  });

  test("QB-17 the whitelist button adds, reports duplicates, and surfaces write failures", async () => {
    const reply = pageWithReply("spammer");

    qb = new CursorConsole();
    qb.mount();
    await settle();
    const button = consoleButton(reply, "whitelist");

    let acted = waitForButtonState(button, "success");
    button.click();
    await acted;
    expect(storageFake.data["whitelist"]).toEqual(["spammer"]);

    // The button debounces via its state machine; reset to idle to drive the next click.
    button.dataset.state = "idle";
    acted = waitForButtonState(button, "success");
    button.click();
    await acted;
    expect(document.querySelector('.xb-toast[data-type="warning"]')).not.toBeNull();

    button.dataset.state = "idle";
    storageFake.failNextGet = true;
    const failed = waitForButtonState(button, "error");
    button.click();
    await failed;
    expect(button.dataset.state).toBe("error");
  });

  test("QB-18 mount observes the DOM and injects into replies added later", async () => {
    qb = new CursorConsole();
    qb.mount();

    const reply = pageWithReply("latecomer");
    await settle();

    expect(reply.querySelector(".xb-console")).not.toBeNull();
  });

  test("QB-19 destroy disconnects the observer and removes injected consoles", async () => {
    const reply = pageWithReply("spammer");
    qb = new CursorConsole();
    qb.mount();
    await settle();
    expect(reply.querySelector(".xb-console")).not.toBeNull();

    qb.destroy();
    qb = null;

    expect(reply.querySelector(".xb-console")).toBeNull();
    const lateReply = createTweetArticle("latecomer").tweetArticle;
    document.body.appendChild(lateReply);
    await settle();
    expect(lateReply.querySelector(".xb-console")).toBeNull();
  });
});

describe("native auto-confirm", () => {
  let qb: QuickBlockService | null = null;

  afterEach(() => {
    qb?.destroy();
    qb = null;
  });

  test("QB-21 confirms a block sheet that follows a native Block click", async () => {
    qb = createQuickBlockService({ mode: "auto-confirm" });
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-22 confirms a mute sheet that follows a native Mute click", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("mute");
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-23 never confirms a sheet with no preceding block/mute (e.g. delete)", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-24 never confirms a delete/unfollow menu click, only block/mute", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("deleteTweet");
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-25 does not confirm once the action is stale (window elapsed)", async () => {
    let clock = 1000;
    qb = new NativeAutoConfirm({ now: () => clock });
    qb.mount();
    clickMenuItem("block");
    clock = 1000 + 2001;
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-28 a later unrelated click disarms the intent before a foreign sheet (mute-no-sheet)", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("mute"); // X showed no sheet for the mute
    clickMenuItem("deleteTweet"); // the user moves on to a destructive action
    const sheet = buildConfirmSheet(); // its (delete) confirmation sheet
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-29 cancelling a confirmation disarms the intent", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("block");
    clickMenuItem("confirmationSheetCancel"); // the user backs out
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-32 arms from a localized Block menu item that has no testid", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickLocalizedMenuItem("封鎖 @spammer"); // zh-Hant "Block"
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-33 arms from a localized Mute menu item that has no testid", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickLocalizedMenuItem("靜音 @noisy"); // zh-Hant "Mute"
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-34 ignores a menu item that is neither block nor mute", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickLocalizedMenuItem("檢舉 @user"); // "Report" -> no auto-confirm
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-26 does nothing when there is no confirmation sheet", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("block");
    await settle();
    expect(document.querySelector('[data-testid="confirmationSheetConfirm"]')).toBeNull();
  });

  test("QB-27 confirms at most once even across later mutations", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    await settle();
    document.body.appendChild(document.createElement("div"));
    await settle();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-35 an armed intent watches mutations: the sheet confirms with no manual scan", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-36 at rest (no armed intent) nothing observes the DOM, so a sheet stays untouched", async () => {
    qb = new NativeAutoConfirm();
    qb.mount();
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-37 the sheet watch expires with the confirm window and stops observing", async () => {
    const timers = installManualTimers();
    try {
      qb = new NativeAutoConfirm();
      qb.mount();
      clickMenuItem("block");
      timers.flushUpTo(AUTO_CONFIRM_WINDOW);
    } finally {
      timers.uninstall();
    }
    const sheet = buildConfirmSheet();
    await settle();
    expect(sheet.clicks()).toBe(0);
  });
});

describe("quick-block service factory", () => {
  let qb: QuickBlockService | null = null;

  afterEach(() => {
    qb?.destroy();
    qb = null;
  });

  test("QB-20 off mode arms nothing and injects no console", async () => {
    const reply = pageWithReply("spammer");
    qb = createQuickBlockService({ mode: "off" });
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    await settle();

    expect(reply.querySelector(".xb-console")).toBeNull();
    expect(sheet.clicks()).toBe(0);
  });
});

describe("ContentSession quick-block integration", () => {
  test("QB-30 a real inline block increments the real rail session count", async () => {
    setWindowLocation("https://x.com/thread_author/status/123456789");
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));
    const session = new ContentSession({ resolveQuickBlockMode: () => "inline" });

    try {
      session.start();
      await settle();
      const button = consoleButton(reply, "block");
      const acted = waitForButtonState(button, "success");
      button.click();
      await acted;

      expect(stub.calls.some((call) => call.url.includes("/blocks/create.json"))).toBe(true);
      expect(document.querySelector(".xb-session-count")?.textContent).toBe("1");
    } finally {
      session.destroy();
      stub.uninstall();
    }
  });

  test("QB-31 navigation destroys the rail but keeps quick-block mounted", () => {
    class FakeRail extends ReplyRail {
      destroys = 0;

      override mount(): void {
        this.root.dataset.xbSurface = "reply-rail";
        document.body.appendChild(this.root);
      }

      override destroy(): void {
        this.destroys += 1;
        this.root.remove();
      }
    }

    const location = { href: "https://x.com/author/status/123456789" };
    const rail = new FakeRail();
    const quickBlock = { destroys: 0, mounts: 0 };
    let navigate = (): void => undefined;
    const session = new ContentSession({
      location,
      createQuickBlockService(_options: CreateQuickBlockServiceOptions) {
        return {
          destroy() {
            quickBlock.destroys += 1;
          },
          mount() {
            quickBlock.mounts += 1;
          },
        };
      },
      createRail: () => rail,
      observeUrlChanges(onChange) {
        navigate = onChange;
        return { disconnect: () => undefined };
      },
      resolveQuickBlockMode: () => "inline",
    });

    try {
      session.start();
      location.href = "https://x.com/i/timeline";
      navigate();

      expect(document.querySelector('[data-xb-surface="reply-rail"]')).toBeNull();
      expect(rail.destroys).toBe(1);
      expect(quickBlock).toEqual({ destroys: 0, mounts: 1 });
    } finally {
      session.destroy();
    }
  });
});
