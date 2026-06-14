// Catalog: QB-* (one-click manual block: the Cursor Console inline strategy and the
// scoped auto-confirm fallback, plus the VITE_QUICK_BLOCK_MODE flag resolution and the
// index.ts wiring that bumps the rail session count on a single block).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_QUICK_BLOCK_MODE,
  normalizeQuickBlockMode,
  QuickBlock,
  resolveQuickBlockMode,
} from "../../entrypoints/content/quick-block.ts";
import {
  createAnonymousTweetArticle,
  createTweetArticle,
  hooks,
  installFetchStub,
  populateTweetPage,
} from "../helpers/content-hooks.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  await tick();
  await tick();
}

function consoleButton(root: ParentNode, action: string): HTMLButtonElement {
  const button = root.querySelector(`.xb-console .xb-btn[data-action="${action}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`expected a ${action} button in the console`);
  }
  return button;
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
    expect(DEFAULT_QUICK_BLOCK_MODE).toBe("inline");
  });

  test("QB-03 resolveQuickBlockMode reads the env flag (unset -> default)", () => {
    expect(resolveQuickBlockMode()).toBe("inline");
  });
});

describe("inline Cursor Console injection", () => {
  let qb: QuickBlock | null = null;

  afterEach(() => {
    qb?.destroy();
    qb = null;
  });

  test("QB-10 injects a console only into replies, never the main tweet", () => {
    const reply = pageWithReply("spammer");
    const main = document.querySelectorAll('article[data-testid="tweet"]')[0];

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();

    expect(reply.querySelectorAll(".xb-console")).toHaveLength(1);
    expect(main?.querySelector(".xb-console")).toBeNull();
    expect(consoleButton(reply, "block").getAttribute("aria-label")).toBe("Block @spammer");
  });

  test("QB-11 gives the reply a positioning context and is idempotent across scans", () => {
    const reply = pageWithReply("spammer");

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();
    qb.scan();

    expect(reply.style.position).toBe("relative");
    expect(reply.querySelectorAll(".xb-console")).toHaveLength(1);
  });

  test("QB-12 skips a reply that has no resolvable author", () => {
    createTweetArticle("thread_author");
    document.body.appendChild(createTweetArticle("thread_author").tweetArticle);
    const anonymous = createAnonymousTweetArticle();
    document.body.appendChild(anonymous);

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();

    expect(anonymous.querySelector(".xb-console")).toBeNull();
  });

  test("QB-13 one click blocks the reply author, veils the reply, and toasts", async () => {
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();
    consoleButton(reply, "block").click();
    await settle();
    stub.uninstall();

    expect(stub.calls.some((call) => call.url.includes("/blocks/create.json"))).toBe(true);
    expect(reply.dataset.xbBlocked).toBe("true");
    expect(document.querySelector('.xb-toast[data-type="success"]')).not.toBeNull();
  });

  test("QB-14 one click mutes the reply author", async () => {
    const reply = pageWithReply("noisy");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();
    consoleButton(reply, "mute").click();
    await settle();
    stub.uninstall();

    expect(stub.calls.some((call) => call.url.includes("/mutes/users/create.json"))).toBe(true);
    expect(reply.dataset.xbBlocked).toBe("true");
  });

  test("QB-15 a whitelisted author is skipped, not blocked", async () => {
    storageFake.data["whitelist"] = ["spammer"];
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();
    consoleButton(reply, "block").click();
    await settle();
    stub.uninstall();

    expect(stub.calls).toHaveLength(0);
    expect(reply.dataset.xbBlocked).toBeUndefined();
    expect(document.querySelector('.xb-toast[data-type="info"]')).not.toBeNull();
  });

  test("QB-16 a failed block surfaces the button error state and does not veil", async () => {
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: false, status: 500 }));

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();
    const button = consoleButton(reply, "block");
    button.click();
    await settle();
    stub.uninstall();

    expect(button.dataset.state).toBe("error");
    expect(reply.dataset.xbBlocked).toBeUndefined();
    expect(document.querySelector('.xb-toast[data-type="warning"]')).not.toBeNull();
  });

  test("QB-17 the whitelist button adds, reports duplicates, and surfaces write failures", async () => {
    const reply = pageWithReply("spammer");

    qb = new QuickBlock({ mode: "inline" });
    qb.scan();
    const button = consoleButton(reply, "whitelist");

    button.click();
    await settle();
    expect(storageFake.data["whitelist"]).toEqual(["spammer"]);

    // The button debounces via its state machine; reset to idle to drive the next click.
    button.dataset.state = "idle";
    button.click();
    await settle();
    expect(document.querySelector('.xb-toast[data-type="warning"]')).not.toBeNull();

    button.dataset.state = "idle";
    storageFake.failNextGet = true;
    button.click();
    await settle();
    expect(button.dataset.state).toBe("error");
  });

  test("QB-18 mount observes the DOM and injects into replies added later", async () => {
    qb = new QuickBlock({ mode: "inline" });
    qb.mount();

    const reply = pageWithReply("latecomer");
    await settle();

    expect(reply.querySelector(".xb-console")).not.toBeNull();
  });

  test("QB-19 destroy disconnects the observer and removes injected consoles", () => {
    const reply = pageWithReply("spammer");
    qb = new QuickBlock({ mode: "inline" });
    qb.mount();
    expect(reply.querySelector(".xb-console")).not.toBeNull();

    qb.destroy();
    qb = null;

    expect(reply.querySelector(".xb-console")).toBeNull();
  });
});

describe("auto-confirm fallback", () => {
  let qb: QuickBlock | null = null;

  afterEach(() => {
    qb?.destroy();
    qb = null;
  });

  test("QB-20 off mode arms nothing and confirms nothing", () => {
    const reply = pageWithReply("spammer");
    qb = new QuickBlock({ mode: "off" });
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    qb.scan();

    expect(reply.querySelector(".xb-console")).toBeNull();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-21 confirms a block sheet that follows a native Block click", () => {
    qb = new QuickBlock({ mode: "auto-confirm" });
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    qb.scan();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-22 confirms a mute sheet that follows a native Mute click", () => {
    qb = new QuickBlock({ mode: "auto-confirm" });
    qb.mount();
    clickMenuItem("mute");
    const sheet = buildConfirmSheet();
    qb.scan();
    expect(sheet.clicks()).toBe(1);
  });

  test("QB-23 never confirms a sheet with no preceding block/mute (e.g. delete)", () => {
    qb = new QuickBlock({ mode: "auto-confirm" });
    qb.mount();
    const sheet = buildConfirmSheet();
    qb.scan();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-24 never confirms a delete/unfollow menu click, only block/mute", () => {
    qb = new QuickBlock({ mode: "auto-confirm" });
    qb.mount();
    clickMenuItem("deleteTweet");
    const sheet = buildConfirmSheet();
    qb.scan();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-25 does not confirm once the action is stale (window elapsed)", () => {
    let clock = 1000;
    qb = new QuickBlock({ mode: "auto-confirm", now: () => clock });
    qb.mount();
    clickMenuItem("block");
    clock = 1000 + 5001;
    const sheet = buildConfirmSheet();
    qb.scan();
    expect(sheet.clicks()).toBe(0);
  });

  test("QB-26 does nothing when there is no confirmation sheet", () => {
    qb = new QuickBlock({ mode: "auto-confirm" });
    qb.mount();
    clickMenuItem("block");
    qb.scan();
    expect(document.querySelector('[data-testid="confirmationSheetConfirm"]')).toBeNull();
  });

  test("QB-27 confirms at most once even across repeated scans", () => {
    qb = new QuickBlock({ mode: "auto-confirm" });
    qb.mount();
    clickMenuItem("block");
    const sheet = buildConfirmSheet();
    qb.scan();
    qb.scan();
    expect(sheet.clicks()).toBe(1);
  });
});

describe("index.ts wiring", () => {
  test("QB-30 a single block through the console bumps the rail session count", async () => {
    setWindowLocation("https://x.com/someone/status/123456789");
    const reply = pageWithReply("spammer");
    const stub = installFetchStub(() => ({ ok: true, status: 200 }));

    hooks.addButtons();
    expect(hooks.getQuickBlock()).not.toBeNull();

    consoleButton(reply, "block").click();
    await settle();
    stub.uninstall();

    const sessionCount = hooks.getRail()?.root.querySelector(".xb-session-count");
    expect(sessionCount?.textContent).toBe("1");
  });

  test("QB-31 leaving the tweet page tears the console down", () => {
    setWindowLocation("https://x.com/someone/status/123456789");
    pageWithReply("spammer");
    hooks.addButtons();
    expect(hooks.getQuickBlock()).not.toBeNull();

    setWindowLocation("https://x.com/i/timeline");
    hooks.checkPageAndAddButton();

    expect(hooks.getQuickBlock()).toBeNull();
    expect(document.querySelector(".xb-console")).toBeNull();
  });
});
