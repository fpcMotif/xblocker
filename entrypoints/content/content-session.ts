import { createQuickBlockService, type QuickBlockService } from "./create-quick-block-service";
import { resolveQuickBlockMode } from "./quick-block-mode";
import { ReplyRail } from "./rail";
import { ensureStyles } from "./styles";
import { applyTheme, observeThemeChanges } from "./theme";

const STATUS_URL = new RegExp(String.raw`https?://(www\.)?x\.com/[^/]+/status/\d+`);

type UrlObserver = { disconnect(): void };

export type ContentSessionDeps = {
  location?: { href: string; hostname?: string };
  createQuickBlockService?: typeof createQuickBlockService;
  createRail?: () => ReplyRail;
  resolveQuickBlockMode?: typeof resolveQuickBlockMode;
  observeUrlChanges?: (onChange: () => void) => UrlObserver;
};

export class ContentSession {
  private readonly location: { href: string; hostname?: string };
  private readonly createQuickBlockService: typeof createQuickBlockService;
  private readonly createRail: () => ReplyRail;
  private readonly resolveQuickBlockMode: typeof resolveQuickBlockMode;
  private readonly observeUrlChanges: (onChange: () => void) => UrlObserver;

  private rail: ReplyRail | null = null;
  private quickBlock: QuickBlockService | null = null;
  private themeObserver: MutationObserver | null = null;
  private urlObserver: UrlObserver | null = null;
  private listenersAttached = false;
  private started = false;

  constructor(deps: ContentSessionDeps = {}) {
    this.location = deps.location ?? window.location;
    this.createQuickBlockService = deps.createQuickBlockService ?? createQuickBlockService;
    this.createRail = deps.createRail ?? (() => new ReplyRail());
    this.resolveQuickBlockMode = deps.resolveQuickBlockMode ?? resolveQuickBlockMode;
    this.observeUrlChanges = deps.observeUrlChanges ?? ((onChange) => this.watchUrl(onChange));
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    ensureStyles();
    this.quickBlock = this.createQuickBlockService({
      mode: this.resolveQuickBlockMode(),
      onActed: (kind) => {
        if (kind === "block") {
          this.rail?.incrementBlocked(1);
        }
      },
    });
    this.quickBlock.mount();
    this.attachListeners();
    this.handleNavigation();
    this.urlObserver = this.observeUrlChanges(() => this.handleNavigation());
  }

  handleNavigation(url = this.location.href): void {
    this.removeRail();
    if (!STATUS_URL.test(url)) {
      return;
    }

    for (const id of ["xblocker-buttons", "xblocker-dashboard"]) {
      document.getElementById(id)?.remove();
    }

    ensureStyles();
    this.rail = this.createRail();
    this.rail.mount();
    applyTheme();
    this.themeObserver = observeThemeChanges();
  }

  destroy(): void {
    this.urlObserver?.disconnect();
    this.urlObserver = null;
    this.removeRail();
    this.quickBlock?.destroy();
    this.quickBlock = null;
    this.detachListeners();
    this.started = false;
  }

  private watchUrl(onChange: () => void): UrlObserver {
    let lastUrl = this.location.href;
    const observer = new MutationObserver(() => {
      if (this.location.href === lastUrl) {
        return;
      }
      lastUrl = this.location.href;
      onChange();
    });
    observer.observe(document, { subtree: true, childList: true });
    return observer;
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.rail?.handleMouseMove(event);
  };

  private readonly onScroll = (): void => {
    this.rail?.handleScroll();
  };

  private readonly onResize = (): void => {
    this.rail?.handleResize();
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    this.rail?.handleKeydown(event);
  };

  private attachListeners(): void {
    if (this.listenersAttached) {
      return;
    }
    this.listenersAttached = true;
    document.addEventListener("mousemove", this.onMouseMove, { passive: true });
    document.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("keydown", this.onKeydown);
  }

  private detachListeners(): void {
    if (!this.listenersAttached) {
      return;
    }
    this.listenersAttached = false;
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("keydown", this.onKeydown);
  }

  private removeRail(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.rail?.destroy();
    this.rail = null;
  }
}
