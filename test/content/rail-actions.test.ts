// Catalog: RA-* (Reply Rail actions: bulk-button reply counts, session counter,
// progress ring, batch block/mute flows, whitelist/settings buttons, drag
// persistence, stored-position clamping, collapsed-handle session badge).
//
// RED against entrypoints/content/rail.ts (created by task 002-impl, extended
// by task 003-impl). Ports the still-valid dock.test.ts assertions onto the
// rail selectors and adds the count-badge and handle-badge scenarios.
//
// Contract pinned here (beyond the 002 state machine):
// - root: HTMLDivElement with data-xb-surface="reply-rail"
// - incrementBlocked(by?: number), setProgress(BatchProgress | null),
//   refreshReplyCounts() reading reply articles capped by settings.maxReplies
// - bulk buttons carry an `.xb-count` badge; the collapsed handle carries an
//   `.xb-handle-count` session badge; drag handle aria-label "Move XBlocker rail"
// - drag release persists the APPLIED position as dockPosition (not the
//   happy-dom zero rect the old dock saved)
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { BatchProgress } from "../../entrypoints/content/actions.ts";
import { ReplyRail } from "../../entrypoints/content/rail.ts";
import {
  installFetchStub,
  installRejectingFetch,
  populateTweetPage,
} from "../helpers/content-hooks.ts";
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

/** The reply-count badge on a bulk action button. */
function getCountBadge(label: string): HTMLElement {
  const badge = getRailButton(label).querySelector(".xb-count");
  if (!(badge instanceof HTMLElement)) {
    throw new Error(`Count badge on "${label}" is missing`);
  }
  return badge;
}

/** The session-count badge on the collapsed handle. */
function getHandleBadge(): HTMLElement {
  const badge = getRailRoot().querySelector(".xb-handle-count");
  if (!(badge instanceof HTMLElement)) {
    throw new Error("Collapsed handle session badge is missing");
  }
  return badge;
}

function getRingBar(): SVGCircleElement {
  const bar = getRailRoot().querySelector(".xb-ring-bar");
  if (!(bar instanceof SVGCircleElement)) {
    throw new Error("Rail ring bar is missing");
  }
  return bar;
}

function getRingCountText(): string {
  return getRailRoot().querySelector(".xb-ring-count")?.textContent ?? "";
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

  test("RA-01 mounts the rail surface with bulk controls, badges, ring, and handle", async () => {
    const mounted = await mountRail();
    const root = getRailRoot();

    expect(root).toBe(mounted.root);
    expect(root.tagName).toBe("DIV");
    expect(root.dataset["xbSurface"]).toBe("reply-rail");
    expect(root.style.right).toBe("16px");

    for (const label of [
      "Move XBlocker rail",
      "Block replies",
      "Mute replies",
      "Whitelist",
      "Open XBlocker settings",
    ]) {
      expect(getRailButton(label)).toBeInstanceOf(HTMLButtonElement);
    }

    expect(getCountBadge("Block replies")).toBeTruthy();
    expect(getCountBadge("Mute replies")).toBeTruthy();
    expect(getHandleBadge().textContent).toBe("0");

    const ringBar = getRingBar();
    expect(ringBar.getAttribute("stroke-dasharray")).toBe("62.83");
    expect(ringBar.getAttribute("stroke-dashoffset")).toBe("62.83");
    expect(getRingCountText()).toBe("0");
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

    expect(getCountBadge("Block replies").textContent).toBe("5");
    expect(getCountBadge("Mute replies").textContent).toBe("5");
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

    expect(getCountBadge("Block replies").textContent).toBe("3");
    expect(getCountBadge("Mute replies").textContent).toBe("3");
  });
});

describe("session counter and progress ring", () => {
  beforeEach(async () => {
    resetTestEnvironment();
    await mountRail();
  });

  test("RA-04 incrementBlocked updates the session count, defaulting to one", () => {
    const mounted = rail!;

    mounted.incrementBlocked();
    expect(getRingCountText()).toBe("1");

    mounted.incrementBlocked(4);
    expect(getRingCountText()).toBe("5");
  });

  test("RA-05 setProgress maps done/total onto the ring stroke offset", () => {
    const mounted = rail!;
    const ringBar = getRingBar();

    const quarter: BatchProgress = { done: 1, total: 4 };
    mounted.setProgress(quarter);
    expect(Number.parseFloat(ringBar.style.strokeDashoffset)).toBeCloseTo(47.1225, 4);

    mounted.setProgress({ done: 4, total: 4 });
    expect(Number.parseFloat(ringBar.style.strokeDashoffset)).toBe(0);
  });

  test("RA-06 setProgress resets to the full circumference on null or empty totals", () => {
    const mounted = rail!;
    const ringBar = getRingBar();

    mounted.setProgress({ done: 1, total: 2 });
    mounted.setProgress(null);
    expect(ringBar.style.strokeDashoffset).toBe("62.83");

    mounted.setProgress({ done: 1, total: 2 });
    mounted.setProgress({ done: 0, total: 0 });
    expect(ringBar.style.strokeDashoffset).toBe("62.83");
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

  test("RA-07 bulk block advances the ring per tick, counts, and toasts the summary", async () => {
    const replies = populateTweetPage(["alice", "bob", "carol"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));
    const blockButton = getRailButton("Block replies");

    blockButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks(30);
    // After the first reply (1 of 3) a third of the ring is drained.
    expect(Number.parseFloat(getRingBar().style.strokeDashoffset)).toBeCloseTo(41.8867, 4);

    manual!.flushUpTo(250);
    await settleMicrotasks(30);
    // Second tick (2 of 3) drains another third.
    expect(Number.parseFloat(getRingBar().style.strokeDashoffset)).toBeCloseTo(20.9433, 4);

    await driveBatch(manual!);

    expect(getRingCountText()).toBe("3");
    expect(getRingBar().style.strokeDashoffset).toBe("62.83");
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

    getRailButton("Block replies").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(getRingCountText()).toBe("1");
    expect(queryToast()?.textContent).toContain("Blocked 1 reply, skipped 1");
    expect(fetchStub.calls).toHaveLength(1);
  });

  test("RA-15 bulk actions do nothing off tweet pages", async () => {
    setWindowLocation("https://x.com/home");
    populateTweetPage(["alice"]);
    fetchStub = installFetchStub(() => ({ ok: true, status: 200 }));

    getRailButton("Block replies").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(fetchStub.calls).toHaveLength(0);
    expect(getRingCountText()).toBe("0");
    expect(queryToast()).toBeNull();
  });

  test("RA-09 bulk mute failure warns about staying signed in and rejects the batch", async () => {
    populateTweetPage(["dave", "erin"]);
    fetchStub = installRejectingFetch();
    const muteButton = getRailButton("Mute replies");

    muteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await driveBatch(manual!);

    expect(getRingCountText()).toBe("0");
    const toast = queryToast();
    expect(toast?.textContent).toContain(
      "Direct mute failed. Please stay signed in to X and retry.",
    );
    expect(toast?.dataset["type"]).toBe("warning");
    // The batch promise rejects; the action button observes the rejection and
    // flips to its error state — the same semantics dock.test.ts pinned.
    expect(muteButton.dataset["state"]).toBe("error");
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
    // The rail saves the applied (clamped) position, so the stored value is
    // the dragged-to point — not the zero rect happy-dom reports.
    expect(storageFake.data["dockPosition"]).toEqual({ x: 40, y: 100 });
    expect(storageFake.setCalls).toHaveLength(1);
  });

  test("RA-13 a stored off-screen position is clamped back into the viewport on mount", async () => {
    storageFake.data["dockPosition"] = { x: 5000, y: -50 };
    await mountRail();

    const root = getRailRoot();
    expect(root.style.right).toBe("auto");
    // y: -50 clamps up to the 8px margin regardless of rail size.
    expect(root.style.top).toBe("8px");
    // x: 5000 clamps back inside the 1024px happy-dom viewport margins.
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

  test("RA-14 the collapsed handle badge shows the session blocked count after Escape", async () => {
    const mounted = await mountRail();

    mounted.incrementBlocked();
    mounted.incrementBlocked();
    mounted.incrementBlocked();
    mounted.incrementBlocked();
    expect(getRingCountText()).toBe("4");

    mounted.handleKeydown(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(getRailRoot().dataset["state"]).toBe("collapsed");
    expect(getHandleBadge().textContent).toBe("4");
  });
});
