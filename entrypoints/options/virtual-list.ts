// Fixed-row-height windowing for the Blocked log table — the only table in the settings
// surface that virtualizes (the whitelist table is flat; see plan.md). `getViewportHeight`
// is an injectable seam rather than always reading `container.clientHeight` directly:
// happy-dom never lays elements out, so tests can't get a real clientHeight, but they CAN
// supply a fixed number and drive `container.scrollTop` + a "scroll" dispatch deterministically.

export type VirtualListOptions<T> = {
  /** The scrollable element; also hosts the top/bottom spacers and the rendered rows. */
  container: HTMLElement;
  rowHeight: number;
  renderRow: (item: T, index: number) => HTMLElement;
  /** Rows kept mounted above/below the visible band, on both edges. */
  overscan?: number;
  /** Defaults to `() => container.clientHeight`. */
  getViewportHeight?: () => number;
};

export type VirtualList<T> = {
  setItems(items: T[]): void;
  /** Re-run the windowing calc without changing the item list (e.g. after a manual
   *  scrollTop write that didn't go through a real "scroll" event). */
  render(): void;
  /** Index of the item whose row element is currently rendered, else undefined. */
  findRowElement(index: number): HTMLElement | null;
  destroy(): void;
};

const DEFAULT_OVERSCAN = 10;

export function createVirtualList<T>(opts: VirtualListOptions<T>): VirtualList<T> {
  const { container, rowHeight, renderRow } = opts;
  const overscan = opts.overscan ?? DEFAULT_OVERSCAN;
  const getViewportHeight = opts.getViewportHeight ?? (() => container.clientHeight);

  let items: T[] = [];

  const topSpacer = document.createElement("div");
  topSpacer.setAttribute("aria-hidden", "true");
  const bottomSpacer = document.createElement("div");
  bottomSpacer.setAttribute("aria-hidden", "true");
  const rowsHost = document.createElement("div");
  container.replaceChildren(topSpacer, rowsHost, bottomSpacer);

  function windowBounds(): { start: number; end: number } {
    const viewportHeight = Math.max(0, getViewportHeight());
    const visibleRows = Math.ceil(viewportHeight / rowHeight);
    const scrollTop = Math.max(0, container.scrollTop);
    // Clamp against the *current* item count: a stale, deep scrollTop left over from a
    // longer list (nothing shrinks it automatically — happy-dom never lays out, and even a
    // real layout pass may lag a synchronous setItems) must not push start past what the
    // now-shorter list has, or start > end and the render loop below emits zero rows.
    const maxStart = Math.max(0, items.length - visibleRows);
    const start = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
    const end = Math.min(items.length, start + visibleRows + overscan * 2);
    return { start, end };
  }

  function render(): void {
    // Row elements are rebuilt from scratch below (replaceChildren), so a plain element
    // reference can't survive the rebuild. Capture the focused row's *identity* — its
    // vl-index — beforehand, then look it up again afterward so roving-tabindex focus
    // isn't dropped to <body> just because a scroll tick re-rendered the window it's in.
    const activeElement = document.activeElement;
    const focusedIndex =
      activeElement instanceof HTMLElement && rowsHost.contains(activeElement)
        ? activeElement.dataset.vlIndex
        : undefined;

    const { start, end } = windowBounds();
    topSpacer.style.height = `${start * rowHeight}px`;
    bottomSpacer.style.height = `${Math.max(0, (items.length - end) * rowHeight)}px`;

    const rows: HTMLElement[] = [];
    for (let index = start; index < end; index++) {
      const item = items[index];
      if (item === undefined) continue;
      const row = renderRow(item, index);
      row.dataset.vlIndex = String(index);
      rows.push(row);
    }
    rowsHost.replaceChildren(...rows);

    if (focusedIndex !== undefined) {
      rowsHost.querySelector<HTMLElement>(`[data-vl-index="${focusedIndex}"]`)?.focus();
    }
  }

  const onScroll = () => render();
  container.addEventListener("scroll", onScroll);

  return {
    setItems(next) {
      // Only reset scroll when the item set actually changed (new array identity) — callers
      // like the blocked-log pane re-call setItems with the *same* filtered array after
      // manually adjusting scrollTop for keyboard nav, and that scroll position must survive.
      if (next !== items) container.scrollTop = 0;
      items = next;
      render();
    },
    render,
    findRowElement(index) {
      return rowsHost.querySelector<HTMLElement>(`[data-vl-index="${index}"]`);
    },
    destroy() {
      container.removeEventListener("scroll", onScroll);
    },
  };
}
