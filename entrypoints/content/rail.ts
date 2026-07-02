import {
  batchState,
  blockReplies,
  countConversationReplies,
  getMaxReplies,
  isReplyArticle,
  muteReplies,
  type BatchProgress,
} from "./actions";
import { createActionButton, createLabeledActionButton, type LabeledActionButton } from "./buttons";
import { createIcon } from "./icons";
import { showWhitelistModal } from "./modal";
import {
  computeRailY,
  exceedsJitter,
  FOLLOW_FACTOR,
  lerp,
  VIEWPORT_MARGIN,
  type Point,
  type Size,
} from "./position";
import { detectTheme } from "./theme";
import { showToast } from "./toast";

export const DWELL_MS = 1000;
export const COLLAPSE_GRACE_MS = 600;

const RAIL_EDGE_OFFSET = 24;
const FALLBACK_WIDTH = 48;
const FALLBACK_HEIGHT = 280;

export type RailStateName = "collapsed" | "tracking" | "settled";
export type RailState = { state: RailStateName; rendered: Point; cursor: Point };

type DockPosition = Point;

function isDockPosition(value: unknown): value is DockPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function loadDockPosition(): Promise<DockPosition | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("dockPosition", (result) => {
      const position: unknown = result?.dockPosition;
      resolve(isDockPosition(position) ? position : null);
    });
  });
}

function saveDockPosition(position: DockPosition): void {
  chrome.storage.local.set({ dockPosition: position }, () => {
    console.log("Rail position saved");
  });
}

export class ReplyRail {
  root: HTMLDivElement;
  private state: RailStateName = "collapsed";
  private cursor: Point = { x: 0, y: 0 };
  private rendered: Point = { x: 0, y: 0 };
  private anchorPoint: Point = { x: 0, y: 0 };
  private anchorTime: number | null = null;
  private needAnchor = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private homePos: DockPosition | null = null;
  private blockedCount = 0;
  // isReplyArticle re-queries every tweet article and heading in the document; at
  // mousemove frequency over a long thread that is the rail's dominant cost. Verdicts
  // only change when the reply region does, so cache per hovered article and recompute
  // on article crossings.
  private lastArticle: Element | null = null;
  private lastArticleIsReply = false;
  private scrollRafId: number | null = null;
  private blockButton: LabeledActionButton;
  private muteButton: LabeledActionButton;
  private sessionIndicator: HTMLSpanElement;
  private sessionCount: HTMLSpanElement;
  private puck: HTMLButtonElement;
  private puckCount: HTMLSpanElement;
  private activeButton: LabeledActionButton | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "xblocker-reply-rail";
    this.root.className = "xb-root xb-rail";
    this.root.dataset.xbSurface = "reply-rail";
    this.root.dataset.xbTheme = detectTheme();
    this.root.dataset.state = "collapsed";
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "XBlocker reply actions");
    this.root.style.right = "16px";
    this.root.style.top = "30%";

    // Collapsed surface: a single quiet puck carrying the session count.
    const puck = document.createElement("button");
    puck.type = "button";
    puck.className = "xb-puck";
    puck.dataset.action = "drag";
    puck.appendChild(createIcon("shield", 22));
    const puckCount = document.createElement("span");
    puckCount.className = "xb-puck-count";
    puck.appendChild(puckCount);
    this.attachDrag(puck);

    // Expanded surface: header + labeled bulk actions + footer.
    const body = document.createElement("div");
    body.className = "xb-rail-body";

    const header = document.createElement("div");
    header.className = "xb-rail-header";
    const headerTitle = document.createElement("span");
    headerTitle.className = "xb-rail-title";
    headerTitle.textContent = "Replies";
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "xb-btn xb-rail-handle";
    handle.dataset.action = "drag";
    handle.setAttribute("aria-label", "Move XBlocker rail");
    handle.title = "Move XBlocker rail";
    handle.appendChild(createIcon("drag", 16));
    this.attachDrag(handle);
    header.append(headerTitle, handle);

    const blockButton = createLabeledActionButton({
      action: "block",
      icon: "block",
      label: "Block all replies",
      text: "Block all",
      variant: "hero",
      onClick: () => this.runBatch("block", this.blockButton),
    });
    const muteButton = createLabeledActionButton({
      action: "mute",
      icon: "mute",
      label: "Mute all replies",
      text: "Mute all",
      variant: "secondary",
      onClick: () => this.runBatch("mute", this.muteButton),
    });

    const footer = document.createElement("div");
    footer.className = "xb-rail-footer";
    const footerActions = document.createElement("div");
    footerActions.className = "xb-rail-footer-actions";
    const whitelistButton = createActionButton({
      action: "whitelist",
      icon: "whitelist",
      label: "Whitelist",
      onClick: () => {
        showWhitelistModal();
      },
    });
    const settingsButton = createActionButton({
      action: "settings",
      icon: "settings",
      label: "Open XBlocker settings",
      onClick: () => {
        showToast("Use the XBlocker extension popup for settings.", "info");
      },
    });
    footerActions.append(whitelistButton, settingsButton);

    const sessionIndicator = document.createElement("span");
    sessionIndicator.className = "xb-session";
    sessionIndicator.title = "Blocked this session";
    sessionIndicator.appendChild(createIcon("shield", 14));
    const sessionCount = document.createElement("span");
    sessionCount.className = "xb-session-count";
    sessionIndicator.appendChild(sessionCount);
    footer.append(footerActions, sessionIndicator);

    body.append(header, blockButton, muteButton, this.divider(), footer);
    this.root.append(puck, body);

    this.blockButton = blockButton;
    this.muteButton = muteButton;
    this.sessionIndicator = sessionIndicator;
    this.sessionCount = sessionCount;
    this.puck = puck;
    this.puckCount = puckCount;

    this.updateSessionDisplays();
  }

  mount(): void {
    if (!this.root.isConnected) {
      document.body.appendChild(this.root);
    }
    const viewport = this.viewport();
    const { width } = this.measure();
    this.rendered = {
      x: Math.max(VIEWPORT_MARGIN, viewport.width - width - RAIL_EDGE_OFFSET),
      y: Math.max(VIEWPORT_MARGIN, viewport.height * 0.3),
    };
    this.applyTransform();
    this.refreshReplyCounts();
    void loadDockPosition().then((position) => {
      if (position) {
        this.applyPosition(position);
      }
      return null;
    });
  }

  destroy(): void {
    this.cancelCollapse();
    this.stopFollowLoop();
    if (this.scrollRafId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
    this.root.remove();
  }

  getState(): RailState {
    return {
      state: this.state,
      rendered: { ...this.rendered },
      cursor: { ...this.cursor },
    };
  }

  incrementBlocked(by = 1): void {
    this.blockedCount += by;
    this.updateSessionDisplays();
  }

  setProgress(progress: BatchProgress | null): void {
    const button = this.activeButton;
    if (!button) {
      return;
    }
    if (!progress || progress.total === 0) {
      button.clearProgress();
      return;
    }
    button.setProgress(progress.done, progress.total);
  }

  refreshReplyCounts(): void {
    void this.updateReplyCounts();
  }

  handleMouseMove(event: MouseEvent): void {
    this.cursor = { x: event.clientX, y: event.clientY };

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (this.root.contains(target)) {
      this.cancelCollapse();
      if (this.state !== "collapsed") {
        this.settle();
      }
      return;
    }

    // Ancestor-only walk: cheap enough for every mousemove. The document-wide
    // modal check is deferred to the reply-hover branch below.
    if (isSuppressedTarget(target)) {
      this.collapseNow();
      return;
    }

    if (batchState.running) {
      if (this.state !== "collapsed") {
        this.cancelCollapse();
        this.settle();
      }
      return;
    }

    const article = target.closest('article[data-testid="tweet"]');
    if (article && this.isReplyArticleCached(article)) {
      // A page-level modal the cursor is not inside still owns the page: never
      // expand beneath it. This is the only per-move document-wide query left,
      // and it runs solely on reply hovers.
      if (hasOpenModalDialog()) {
        this.collapseNow();
        return;
      }
      this.cancelCollapse();
      if (this.state === "collapsed") {
        this.anchorPoint = { ...this.cursor };
        this.needAnchor = true;
        this.setState("tracking");
        this.startFollowLoop();
        // The reply set grows as X streams more in; refresh the badge on each
        // expansion so "Block all (n)" reflects what a batch would act on now.
        this.refreshReplyCounts();
      } else if (exceedsJitter(this.anchorPoint, this.cursor)) {
        this.anchorPoint = { ...this.cursor };
        this.needAnchor = true;
        if (this.state === "settled") {
          this.setState("tracking");
          this.startFollowLoop();
        }
      }
      return;
    }

    if (this.state !== "collapsed") {
      this.settle();
      this.scheduleCollapse();
    }
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.collapseNow();
    }
  }

  handleScroll(): void {
    if (this.state === "collapsed") {
      return;
    }
    // Coalesce to one clamp per frame: measure() forces a reflow, and scroll events
    // fire far more often than the screen paints.
    if (typeof window.requestAnimationFrame !== "function") {
      this.clampToViewport();
      return;
    }
    if (this.scrollRafId !== null) {
      return;
    }
    this.scrollRafId = window.requestAnimationFrame(() => {
      this.scrollRafId = null;
      this.clampToViewport();
    });
  }

  private clampToViewport(): void {
    if (this.state === "collapsed") {
      return;
    }
    const viewport = this.viewport();
    const { height } = this.measure();
    this.rendered.y = clampY(this.rendered.y, height, viewport);
    this.applyTransform();
  }

  private isReplyArticleCached(article: Element): boolean {
    if (article !== this.lastArticle) {
      this.lastArticle = article;
      this.lastArticleIsReply = isReplyArticle(article);
    }
    return this.lastArticleIsReply;
  }

  /** Advances motion and dwell by one frame. Deterministic for tests. */
  step(nowMs?: number): void {
    const now = nowMs ?? performance.now();

    if (this.state === "tracking") {
      if (this.needAnchor || this.anchorTime === null) {
        this.anchorTime = now;
        this.needAnchor = false;
      } else if (now - this.anchorTime >= DWELL_MS) {
        this.settle();
      }
    }

    const viewport = this.viewport();
    const { height } = this.measure();
    if (this.state === "tracking") {
      const target = computeRailY(this.cursor.y, height, viewport);
      this.rendered.y = prefersReducedMotion()
        ? target
        : lerp(this.rendered.y, target, FOLLOW_FACTOR);
    } else if (this.state === "settled") {
      this.rendered.y = clampY(this.rendered.y, height, viewport);
    }
    this.applyTransform();
  }

  private updateSessionDisplays(): void {
    const count = this.blockedCount;
    const text = String(count);
    this.sessionCount.textContent = text;
    this.puckCount.textContent = text;
    const empty = count === 0;
    this.sessionIndicator.hidden = empty;
    this.puckCount.hidden = empty;
    this.puck.setAttribute("aria-label", `XBlocker — ${text} blocked this session`);
  }

  private async updateReplyCounts(): Promise<void> {
    const maxReplies = await getMaxReplies();
    const count = Math.min(countConversationReplies(), maxReplies);
    this.blockButton.setCount(count);
    this.muteButton.setCount(count);
  }

  private async runBatch(kind: "block" | "mute", button: LabeledActionButton): Promise<void> {
    // Block-all and Mute-all act on the same reply set, so a second bulk click while one
    // batch is in flight would hit the actions-layer batchState guard, return null, and
    // (1) paint a false success check on the second button and (2) null activeButton, freezing
    // the running batch's progress. Disable the sibling synchronously here — before the first
    // await closes the re-entry window — and restore it in the finally so the early-return and
    // thrown-failure paths both re-enable it (never leaving it stuck disabled).
    const sibling = button === this.blockButton ? this.muteButton : this.blockButton;
    sibling.disabled = true;
    this.activeButton = button;
    try {
      const run = kind === "block" ? blockReplies : muteReplies;
      const summary = await run((progress) => {
        this.setProgress(progress);
      });
      this.setProgress(null);

      if (!summary) {
        return;
      }
      if (kind === "block") {
        this.incrementBlocked(summary.acted);
      }

      if (summary.acted > 0) {
        const verb = kind === "block" ? "Blocked" : "Muted";
        const noun = summary.acted === 1 ? "reply" : "replies";
        const skipped = summary.skipped ? `, skipped ${summary.skipped}` : "";
        showToast(`${verb} ${summary.acted} ${noun}${skipped}`, "success");
      } else if (summary.failed > 0) {
        showToast(`Direct ${kind} failed. Please stay signed in to X and retry.`, "warning");
        throw new Error(`Batch ${kind} failed.`);
      }
    } finally {
      sibling.disabled = false;
      this.activeButton = null;
      // The batch changed what remains actionable; update the "(n)" badges.
      this.refreshReplyCounts();
    }
  }

  private divider(): HTMLSpanElement {
    const divider = document.createElement("span");
    divider.className = "xb-divider-h";
    return divider;
  }

  private applyPosition(position: DockPosition): void {
    const { width, height } = this.measure();
    const viewport = this.viewport();
    const maxX = Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN);
    const x = Math.min(Math.max(position.x, VIEWPORT_MARGIN), maxX);
    const y = Math.min(Math.max(position.y, VIEWPORT_MARGIN), maxY);
    this.homePos = { x, y };
    this.rendered.x = x;
    if (this.state === "collapsed") {
      this.rendered.y = y;
    }
    this.root.style.right = "auto";
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  }

  private attachDrag(handle: HTMLElement): void {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("pointerdown", (event) => {
      if (dragging) {
        return;
      }
      dragging = true;
      const rect = this.root.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      if (typeof handle.setPointerCapture === "function") {
        handle.setPointerCapture(event.pointerId);
      }
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      this.applyPosition({ x: event.clientX - offsetX, y: event.clientY - offsetY });
    });

    const finish = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      if (typeof handle.releasePointerCapture === "function") {
        handle.releasePointerCapture(event.pointerId);
      }
      if (this.homePos) {
        saveDockPosition(this.homePos);
      }
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  private setState(state: RailStateName): void {
    this.state = state;
    this.root.dataset.state = state;
  }

  private settle(): void {
    if (this.state !== "settled") {
      this.setState("settled");
    }
    this.stopFollowLoop();
  }

  private collapseNow(): void {
    this.cancelCollapse();
    if (this.state !== "collapsed") {
      this.setState("collapsed");
    }
    this.stopFollowLoop();
    this.anchorTime = null;
    this.needAnchor = false;
  }

  private scheduleCollapse(): void {
    this.cancelCollapse();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.collapseNow();
    }, COLLAPSE_GRACE_MS);
  }

  private cancelCollapse(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private applyTransform(): void {
    if (this.state === "collapsed") {
      this.root.style.transform = "";
      return;
    }
    const homeY = this.homePos ? this.homePos.y : this.viewport().height * 0.3;
    this.root.style.transform = `translate3d(0, ${this.rendered.y - homeY}px, 0)`;
  }

  private measure(): Size {
    const rect = this.root.getBoundingClientRect();
    return {
      width: rect.width || this.root.offsetWidth || FALLBACK_WIDTH,
      height: rect.height || this.root.offsetHeight || FALLBACK_HEIGHT,
    };
  }

  private viewport(): Size {
    return { width: window.innerWidth || 0, height: window.innerHeight || 0 };
  }

  private startFollowLoop(): void {
    if (this.rafId !== null || typeof window.requestAnimationFrame !== "function") {
      return;
    }
    const tick = () => {
      if (this.state !== "tracking") {
        this.rafId = null;
        return;
      }
      this.step();
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopFollowLoop(): void {
    if (this.rafId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }
}

function clampY(y: number, height: number, viewport: Size): number {
  const max = Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN);
  return Math.min(Math.max(y, VIEWPORT_MARGIN), max);
}

// Ancestor-only checks (an editor, or the inside of a modal): safe to run on every
// mousemove. The "a modal is open ANYWHERE" question needs a document-wide query, so
// it lives in hasOpenModalDialog and is asked only before expanding over a reply.
function isSuppressedTarget(target: Element): boolean {
  return (
    target.closest(
      'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="dialog"][aria-modal="true"]',
    ) !== null
  );
}

function hasOpenModalDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
