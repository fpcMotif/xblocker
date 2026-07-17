type NativeAction = "block" | "mute";

export type NativeAutoConfirmOptions = {
  now?: () => number;
};

const AUTO_CONFIRM_WINDOW_MS = 2000;
const BLOCK_LABELS = ["block", "封鎖", "封锁", "屏蔽"];
const MUTE_LABELS = ["mute", "靜音", "静音"];

function intentFromClick(target: Element): NativeAction | null {
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

export class NativeAutoConfirm {
  private readonly now: () => number;
  private observer: MutationObserver | null = null;
  private sheetWatchTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingAt: number | null = null;

  private readonly nativeActionListener = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const intent = intentFromClick(target);
    if (intent) {
      this.pendingAt = this.now();
      this.startSheetWatch();
    } else if (!target.closest('[data-testid="confirmationSheetConfirm"]')) {
      this.pendingAt = null;
      this.stopSheetWatch();
    }
  };

  constructor(options: NativeAutoConfirmOptions = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  mount(): void {
    document.addEventListener("click", this.nativeActionListener, true);
  }

  destroy(): void {
    this.pendingAt = null;
    this.stopSheetWatch();
    document.removeEventListener("click", this.nativeActionListener, true);
  }

  private startSheetWatch(): void {
    if (!this.observer) {
      this.observer = new MutationObserver(() => {
        this.scan();
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }

    if (this.sheetWatchTimer !== null) {
      clearTimeout(this.sheetWatchTimer);
    }
    this.sheetWatchTimer = setTimeout(() => {
      this.sheetWatchTimer = null;
      this.stopSheetWatch();
    }, AUTO_CONFIRM_WINDOW_MS);

    this.scan();
  }

  private stopSheetWatch(): void {
    if (this.sheetWatchTimer !== null) {
      clearTimeout(this.sheetWatchTimer);
      this.sheetWatchTimer = null;
    }
    this.observer?.disconnect();
    this.observer = null;
  }

  private scan(): void {
    const confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (!(confirm instanceof HTMLElement) || confirm.dataset.xbAutoConfirmed === "true") {
      return;
    }

    if (this.pendingAt === null || this.now() - this.pendingAt > AUTO_CONFIRM_WINDOW_MS) {
      return;
    }

    this.pendingAt = null;
    confirm.dataset.xbAutoConfirmed = "true";
    confirm.click();
    this.stopSheetWatch();
  }
}
