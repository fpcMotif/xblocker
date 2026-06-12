import {
  batchState,
  blockReplies,
  getMaxReplies,
  isReplyArticle,
  muteReplies,
  type BatchProgress,
} from "./actions";
import { createActionButton } from "./buttons";
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
const RING_CIRCUMFERENCE = 62.83;

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
  private ringBar: SVGCircleElement;
  private ringCount: HTMLSpanElement;
  private handleCount: HTMLSpanElement;
  private blockCount: HTMLSpanElement;
  private muteCount: HTMLSpanElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "xblocker-reply-rail";
    this.root.className = "xb-root xb-dock";
    this.root.dataset.xbSurface = "reply-rail";
    this.root.dataset.xbTheme = detectTheme();
    this.root.dataset.state = "collapsed";
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "XBlocker reply actions");
    this.root.style.right = "16px";
    this.root.style.top = "30%";

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "xb-btn xb-dock-handle";
    handle.dataset.action = "drag";
    handle.setAttribute("aria-label", "Move XBlocker rail");
    handle.title = "Move XBlocker rail";
    handle.appendChild(createIcon("drag", 16));
    const handleCount = document.createElement("span");
    handleCount.className = "xb-handle-count";
    handleCount.textContent = "0";
    handle.appendChild(handleCount);
    this.attachDrag(handle);

    const blockButton = createActionButton({
      action: "block",
      icon: "block",
      label: "Block replies",
      onClick: () => this.runBatch("block"),
    });
    this.blockCount = this.appendCountBadge(blockButton);
    const muteButton = createActionButton({
      action: "mute",
      icon: "mute",
      label: "Mute replies",
      onClick: () => this.runBatch("mute"),
    });
    this.muteCount = this.appendCountBadge(muteButton);
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

    const ring = document.createElement("div");
    ring.className = "xb-ring";
    ring.title = "Blocked this session";
    const svgNs = "http://www.w3.org/2000/svg";
    const ringSvg = document.createElementNS(svgNs, "svg");
    ringSvg.setAttribute("width", "32");
    ringSvg.setAttribute("height", "32");
    ringSvg.setAttribute("viewBox", "0 0 24 24");
    ringSvg.setAttribute("aria-hidden", "true");
    ringSvg.style.transform = "rotate(-90deg)";
    const ringTrack = document.createElementNS(svgNs, "circle");
    ringTrack.setAttribute("class", "xb-ring-track");
    const ringBar = document.createElementNS(svgNs, "circle");
    ringBar.setAttribute("class", "xb-ring-bar");
    for (const circle of [ringTrack, ringBar]) {
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", "10");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke-width", "2");
    }
    ringBar.setAttribute("stroke-linecap", "round");
    ringBar.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
    ringBar.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
    ringSvg.appendChild(ringTrack);
    ringSvg.appendChild(ringBar);
    ring.appendChild(ringSvg);
    const count = document.createElement("span");
    count.className = "xb-ring-count";
    count.textContent = "0";
    count.setAttribute("aria-label", "Replies blocked this session");
    ring.appendChild(count);

    this.ringBar = ringBar;
    this.ringCount = count;
    this.handleCount = handleCount;

    this.root.appendChild(handle);
    this.root.appendChild(this.divider());
    this.root.appendChild(blockButton);
    this.root.appendChild(muteButton);
    this.root.appendChild(whitelistButton);
    this.root.appendChild(this.divider());
    this.root.appendChild(ring);
    this.root.appendChild(settingsButton);
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
    this.ringCount.textContent = String(this.blockedCount);
    this.handleCount.textContent = String(this.blockedCount);
  }

  setProgress(progress: BatchProgress | null): void {
    if (!progress || progress.total === 0) {
      this.ringBar.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
      return;
    }
    const fraction = progress.done / progress.total;
    this.ringBar.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
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
    if (article && isReplyArticle(article)) {
      this.cancelCollapse();
      if (this.state === "collapsed") {
        this.anchorPoint = { ...this.cursor };
        this.needAnchor = true;
        this.setState("tracking");
        this.startFollowLoop();
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
    const viewport = this.viewport();
    const { height } = this.measure();
    this.rendered.y = clampY(this.rendered.y, height, viewport);
    this.applyTransform();
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

  private async updateReplyCounts(): Promise<void> {
    const maxReplies = await getMaxReplies();
    const articles = document.querySelectorAll('article[data-testid="tweet"]').length;
    const count = Math.min(Math.max(0, articles - 1), maxReplies);
    this.blockCount.textContent = String(count);
    this.muteCount.textContent = String(count);
  }

  private async runBatch(kind: "block" | "mute"): Promise<void> {
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
  }

  private appendCountBadge(button: HTMLButtonElement): HTMLSpanElement {
    const badge = document.createElement("span");
    badge.className = "xb-count";
    badge.textContent = "0";
    button.appendChild(badge);
    return badge;
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

function isSuppressedTarget(target: Element): boolean {
  if (
    target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')
  ) {
    return true;
  }
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
