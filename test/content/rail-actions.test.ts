// Catalog: RA-* (Reply Rail actions: labeled bulk-button reply counts, footer
// session indicator, on-button batch progress, batch block/mute flows,
// whitelist/settings buttons, drag persistence, stored-position clamping,
// collapsed-puck session badge).
//
// Drives entrypoints/content/rail.ts. The rail's resting surface is a puck; the
// expanded body carries the labeled "Block all" / "Mute all" buttons. Counts
// hide at zero, and batch progress rides the triggering button (n / total + a
// determinate fill) rather than a standalone ring.
//
// Contract pinned here:
// - root: HTMLDivElement with data-xb-surface="reply-rail", role="group"
// - incrementBlocked(by?: number), setProgress(BatchProgress | null),
//   refreshReplyCounts() reading reply articles capped by settings.maxReplies
// - bulk buttons are labeled (aria-label "Block all replies" / "Mute all replies")
//   and carry an `.xb-count` chip hidden at zero
// - footer `.xb-session` indicator + collapsed `.xb-puck-count` badge show the
//   session blocked count, hidden while it is zero
// - drag release persists the APPLIED position as dockPosition
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ReplyRail } from "../../entrypoints/content/rail.ts";
import {
  appendDiscoverMoreSection,
  installFetchStub,
  installRejectingFetch,
  populateTweetPage,
} from "../helpers/content-dom.ts";
import { installManualTimers, settleMicrotasks, type ManualTimers } from "../helpers/timers.ts";
import {
  resetTestEnvironment,
  setDocumentCookie,
  setWindowLocation,
  storageFake,
} from "../setup.ts";

let rail: ReplyRail | null = null;

/** Construct and mount a fresh rail; settles the async stored-position load. */
async function mountRail(): Promise<ReplyRail> {
  rail = new ReplyRail();
  rail.mount();
  await settleMicrotasks();
  return rail;
}

afterEach(() => {
  rail?.destroy();
  rail = null;
});

function getRailRoot(): HTMLElement {
  const root = document.querySelector('[data-xb-surface="reply-rail"]');
  if (!(root instanceof HTMLElement)) {
    throw new Error("Reply rail is not mounted");
  }
  return root;
}

function getRailButton(label: string): HTMLButtonElement {
  const button = getRailRoot().querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Rail button "${label}" is missing`);
  }
  return button;
}

function getDragHandle(): HTMLButtonElement {
  return getRailButton("Move XBlocker rail");
}

/** The reply-count chip on a labeled bulk action button. */
function getCountBadge(label: string): HTMLElement {
  const badge = getRailButton(label).querySelector(".xb-count");
  if (!(badge instanceof HTMLElement)) {
    throw new Error(`Count chip on "${label}" is missing`);
  }
  return badge;
}

/** Visible label text of a labeled bulk action button. */
function getButtonText(label: string): string {
  return getRailButton(label).querySelector(".xb-btn-text")?.textContent ?? "";
}

/** The footer session indicator wrapper (hidden while the count is zero). */
function getSessionIndicator(): HTMLElement {
  const indicator = getRailRoot().querySelector(".xb-session");
  if (!(indicator instanceof HTMLElement)) {
    throw new Error("Session indicator is missing");
  }
  return indicator;
}

function getSessionCount(): string {
  return getRailRoot().querySelector(".xb-session-count")?.textContent ?? "";
}

/** The collapsed puck's session-count badge. */
function getPuckCount(): HTMLElement {
  const badge = getRailRoot().querySelector(".xb-puck-count");
  if (!(badge instanceof HTMLElement)) {
    throw new Error("Puck session badge is missing");
  }
  return badge;
}

function queryToast(): HTMLElement | null {
  const toast = document.querySelector(".xb-toast");
  return toast instanceof HTMLElement ? toast : null;
}

function pointerEvent(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX, clientY });
}

/** Drive a manual-timer batch to completion: settle microtasks, flush only waitFor delays. */
async function driveBatch(manual: ManualTimers, rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await settleMicrotasks(30);
    manual.flushUpTo(250);
  }
  await settleMicrotasks(30);
}

describe("rail anatomy", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("RA-01 mounts the rail with labeled actions, footer, session indicator, and puck", async () => {
    const mounted = await mountRail();
    const root = getRailRoot();

    expect(root).toBe(mounted.root);
    expect(root.tagName).toBe("DIV");
    expect(root.dataset["xbSurface"]).toBe("reply-rail");
    expect(root.getAttribute("role")).toBe("group");
    expect(root.getAttribute("aria-label")).toBe("XBlocker reply actions");
    expect(root.style.right).toBe("16px");

    for (const label of [
      "Move XBlocker rail",
      "Block all replies",
      "Mute all replies",
      "Whitelist",
      "Open XBlocker settings",
    ]) {
      expect(getRailButton(label)).toBeInstanceOf(HTMLButtonElement);
    }

    expect(getButtonText("Block all replies")).toBe("Block all");
    expect(getButtonText("Mute all replies")).toBe("Mute all");
    expect(getRailButton("Block all replies").dataset["variant"]).toBe("hero");
    expect(getRailButton("Mute all replies").dataset["variant"]).toBe("secondary");

    // Counts and the session indicator are hidden at zero; the old ring and
    // handle badge are gone.
    expect(getCountBadge("Block all replies").hidden).toBe(true);
    expect(getCountBadge("Mute all replies").hidden).toBe(true);
    expect(getSessionIndicator().hidden).toBe(true);
    expect(root.querySelector(".xb-handle-count")).toBeNull();
    expect(root.querySelector(".xb-ring")).toBeNull();
    expect(root.querySelector(".xb-ring-bar")).toBeNull();

    // The collapsed puck is the resting surface.
    expect(root.querySelector(".xb-puck")).not.toBeNull();
  });
});

describe("bulk button reply counts", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("RA-02 shows the loaded reply count on the block and mute buttons", async () => {
    storageFake.data["settings"] = { maxReplies: 100 };
    populateTweetPage([
      "reply_user_1",
      "reply_user_2",
      "reply_user_3",
      "reply_user_4",
      "reply_user_5",
    ]);
    const mounted = await mountRail();

    mounted.refreshReplyCounts();
    await settleMicrotasks();

    expect(getCountBadge("Block all replies").textContent).toBe("5");
    expect(getCountBadge("Block all replies").hidden).toBe(false);
    expect(getCountBadge("Mute all replies").textContent).toBe("5");
  });

  test("RA-03 caps the displayed counts at the stored maxReplies", async () => {
    storageFake.data["settings"] = { maxReplies: 3 };
    populateTweetPage([
      "reply_user_1",
      "reply_user_2",
      "reply_user_3",
      "reply_user_4",
      "reply_user_5",
    ]);
    const mounted = await mountRail();

    mounted.refreshReplyCounts();
    await settleMicrotasks();

    expect(getCountBadge("Block all replies").textContent).toBe("3");
    expect(getCountBadge("Mute all replies").textContent).toBe("3");
  });

  test("RA-17 excludes Discover more recommendations from the badge count", async () => {
    storageFake.data["settings"] = { maxReplies: 100 };
    populateTweetPage(["reply_user_1", "reply_user_2"]);
    // A recommended post after the "Discover more" heading is not a reply, so it
    // must not inflate the badge the way a raw article count would.
    appendDiscoverMoreSection(["recommended_one"]);
    const mounted = await mountRail();

    mounted.refreshReplyCounts();
    await settleMicrotasks();

    expect(getCountBadge("Block all replies").textContent).toBe("2");
    expect(getCountBadge("Mute all replies").textContent).toBe("2");
  });
});

describe("session counter and on-button progress", () => {
  beforeEach(async () => {
    resetTestEnvironment();
    await mountRail();
  });

  test("RA-04 incrementBlocked reveals and updates the session indicator, defaulting to one", () => {
    const mounted = rail!;
    expect(getSessionIndicator().hidden).toBe(true);

    mounted.incrementBlocked();
    expect(getSessionCount()).toBe("1");
    expect(getSessionIndicator().hidden).toBe(false);

    mounted.incrementBlocked(4);
    expect(getSessionCount()).toBe("5");
  });

  test("RA-05 setProgress is a no-op while no batch owns a button", () => {
    const mounted = rail!;
    const block = getRailButton("Block all replies");

    mounted.setProgress({ done: 1, total: 4 });
    mounted.setProgress(null);

    expect(block.hasAttribute("data-progress")).toBe(false);
    expect(getButtonText("Block all replies")).toBe("Block all");
  });
});

describe("rail batch actions", () => {
  let manual: ManualTimers | null = null;
  let fetchStub: {
    calls: { url: string; init: RequestInit | undefined }[];
    uninstall: () => void;
  } | null = null;

  beforeEach(async () => {
    resetTestEnvironment();
    setDocumentCookie("ct0=test-csrf-token");
    manual = installManualTimers();
    await mountRail();
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
    manual?.uninstall();
    manual = null;
  });

  test("RA-07 bulk block shows on-button progress, counts the session, and toasts", async () => {
    const replies = populateTweetPage(["alice", "bob", "carol"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const blockButton = getRailButton("Block all replies");

    blockButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(30);
    // After the first reply (1 of 3) the button shows a live readout + fill.
    expect(getButtonText("Block all replies")).toBe("1 / 3");
    expect(blockButton.dataset["progress"]).toBe("true");
    expect(Number.parseFloat(blockButton.style.getPropertyValue("--xb-progress"))).toBeCloseTo(
      1 / 3,
      4,
    );

    manual!.flushUpTo(250);
    await settleMicrotasks(30);
    expect(getButtonText("Block all replies")).toBe("2 / 3");

    await driveBatch(manual!);

    // Completion: session counted + revealed, label restored, fill cleared.
    expect(getSessionCount()).toBe("3");
    expect(getSessionIndicator().hidden).toBe(false);
    expect(getButtonText("Block all replies")).toBe("Block all");
    expect(blockButton.hasAttribute("data-progress")).toBe(false);
    const toast = queryToast();
    expect(toast?.textContent).toContain("Blocked 3 replies");
    expect(toast?.textContent).not.toContain("skipped");
    expect(toast?.dataset["type"]).toBe("success");
    expect(blockButton.dataset["state"]).toBe("success");
    for (const reply of replies) {
      expect(reply.dataset["xbBlocked"]).toBe("true");
    }
    expect(fetchStub.calls).toHaveLength(3);
    expect(fetchStub.calls[0]?.url).toBe("https://api.x.com/1.1/blocks/create.json");
    expect(fetchStub.calls[0]?.init?.method).toBe("POST");
  });

  test("RA-08 bulk block toast summarizes skipped whitelisted replies", async () => {
    storageFake.data["whitelist"] = ["bob"];
    populateTweetPage(["alice", "bob"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));

    getRailButton("Block all replies").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(getSessionCount()).toBe("1");
    expect(queryToast()?.textContent).toContain("Blocked 1 reply, skipped 1");
    expect(fetchStub.calls).toHaveLength(1);
  });

  test("RA-15 bulk actions do nothing off tweet pages", async () => {
    setWindowLocation("https://x.com/home");
    populateTweetPage(["alice"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));

    getRailButton("Block all replies").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(fetchStub.calls).toHaveLength(0);
    expect(getSessionCount()).toBe("0");
    expect(queryToast()).toBeNull();
  });

  test("RA-09 bulk mute failure warns about staying signed in and rejects the batch", async () => {
    populateTweetPage(["dave", "erin"]);
    fetchStub = installRejectingFetch();
    const muteButton = getRailButton("Mute all replies");

    muteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(getSessionCount()).toBe("0");
    const toast = queryToast();
    expect(toast?.textContent).toContain(
      "Direct mute failed. Please stay signed in to X and retry.",
    );
    expect(toast?.dataset["type"]).toBe("warning");
    // The batch promise rejects; the action button observes the rejection and
    // flips to its error state.
    expect(muteButton.dataset["state"]).toBe("error");
  });

  test("RA-16 a successful bulk mute never increments the session indicator", async () => {
    populateTweetPage(["alice", "bob"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const muteButton = getRailButton("Mute all replies");

    muteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(getSessionCount()).toBe("0");
    expect(getSessionIndicator().hidden).toBe(true);
    expect(queryToast()?.textContent).toContain("Muted 2 replies");
    expect(muteButton.dataset["state"]).toBe("success");
  });

  test("RA-18 a running bulk batch disables the sibling button so it cannot false-succeed", async () => {
    populateTweetPage(["alice", "bob", "carol"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const blockButton = getRailButton("Block all replies");
    const muteButton = getRailButton("Mute all replies");

    blockButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(30);
    // The block batch owns the page: the sibling mute button is disabled.
    expect(getButtonText("Block all replies")).toBe("1 / 3");
    expect(muteButton.disabled).toBe(true);

    // A concurrent mute click (the bug's trigger) must do nothing: no busy/success
    // paint on mute, and the running block batch keeps advancing its own progress.
    muteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(30);
    expect(muteButton.dataset["state"]).toBe("idle");
    expect(muteButton.hasAttribute("data-progress")).toBe(false);

    manual!.flushUpTo(250);
    await settleMicrotasks(30);
    expect(getButtonText("Block all replies")).toBe("2 / 3");

    await driveBatch(manual!);

    // The block batch completes correctly and the mute button is re-enabled, never
    // having muted anyone — only block endpoints were called.
    expect(getSessionCount()).toBe("3");
    expect(blockButton.dataset["state"]).toBe("success");
    expect(muteButton.disabled).toBe(false);
    expect(muteButton.dataset["state"]).toBe("idle");
    expect(fetchStub.calls).toHaveLength(3);
    expect(fetchStub.calls.every((call) => call.url.includes("/blocks/create.json"))).toBe(true);
  });
});

describe("whitelist and settings buttons", () => {
  let manual: ManualTimers | null = null;

  beforeEach(async () => {
    resetTestEnvironment();
    manual = installManualTimers();
    await mountRail();
  });

  afterEach(() => {
    manual?.uninstall();
    manual = null;
  });

  test("RA-10 whitelist button opens the whitelist modal", async () => {
    getRailButton("Whitelist").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks();

    const modal = document.getElementById("xblocker-modal");
    expect(modal).toBeTruthy();
    expect(modal?.querySelector('[role="dialog"]')).toBeTruthy();
    expect(getRailButton("Whitelist").dataset["state"]).toBe("success");
  });

  test("RA-11 settings button shows the popup-pointer toast", async () => {
    getRailButton("Open XBlocker settings").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleMicrotasks();

    const toast = queryToast();
    expect(toast?.textContent).toContain("Use the XBlocker extension popup for settings.");
    expect(toast?.dataset["type"]).toBe("info");
    expect(getRailButton("Open XBlocker settings").dataset["state"]).toBe("success");
  });
});

describe("drag persistence and stored positions", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("RA-12 dragging the handle to (40, 100) persists that home position", async () => {
    await mountRail();
    const handle = getDragHandle();
    const root = getRailRoot();

    handle.dispatchEvent(pointerEvent("pointerdown", 0, 0));
    handle.dispatchEvent(pointerEvent("pointermove", 40, 100));
    expect(root.style.left).toBe("40px");
    expect(root.style.top).toBe("100px");
    expect(root.style.right).toBe("auto");

    handle.dispatchEvent(pointerEvent("pointerup", 40, 100));
    expect(storageFake.data["dockPosition"]).toEqual({ x: 40, y: 100 });
    expect(storageFake.setCalls).toHaveLength(1);
  });

  test("RA-13 a stored off-screen position is clamped back into the viewport on mount", async () => {
    storageFake.data["dockPosition"] = { x: 5000, y: -50 };
    await mountRail();

    const root = getRailRoot();
    expect(root.style.right).toBe("auto");
    expect(root.style.top).toBe("8px");
    const left = Number.parseFloat(root.style.left);
    expect(Number.isFinite(left)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(1016);
  });
});

describe("session count survives collapse", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("RA-14 the collapsed puck badge shows the session blocked count after Escape", async () => {
    const mounted = await mountRail();

    mounted.incrementBlocked();
    mounted.incrementBlocked();
    mounted.incrementBlocked();
    mounted.incrementBlocked();
    expect(getSessionCount()).toBe("4");

    mounted.handleKeydown(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(getRailRoot().dataset["state"]).toBe("collapsed");
    expect(getPuckCount().textContent).toBe("4");
    expect(getPuckCount().hidden).toBe(false);
  });
});
