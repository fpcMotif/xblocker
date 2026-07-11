// Catalog: OV-* (createVirtualList: fixed-row windowing math at 0/5/2000 items, plus
// scroll-reset-on-shrink and focus-preservation-across-rerender edge cases).
import { beforeEach, describe, expect, test } from "bun:test";

import { createVirtualList } from "../../entrypoints/options/virtual-list.ts";
import { resetTestEnvironment } from "../setup.ts";

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function renderedIndices(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-vl-index]")).map((el) =>
    Number(el.dataset["vlIndex"]),
  );
}

describe("createVirtualList", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OV-01 renders nothing for an empty list, with zero-height spacers", () => {
    const container = makeContainer();
    const list = createVirtualList<string>({
      container,
      rowHeight: 40,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 400,
    });

    list.setItems([]);

    expect(renderedIndices(container)).toEqual([]);
    const [top, , bottom] = Array.from(container.querySelectorAll<HTMLElement>(":scope > *"));
    expect(top?.style.height).toBe("0px");
    expect(bottom?.style.height).toBe("0px");
  });

  test("OV-02 a small (5-row) list with a viewport taller than the content renders every row once", () => {
    const container = makeContainer();
    let renderCalls = 0;
    const list = createVirtualList<string>({
      container,
      rowHeight: 40,
      renderRow: (item) => {
        renderCalls++;
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 400,
    });

    const items = ["a", "b", "c", "d", "e"];
    list.setItems(items);

    expect(renderedIndices(container)).toEqual([0, 1, 2, 3, 4]);
    expect(renderCalls).toBe(5);
    expect(list.findRowElement(2)?.textContent).toBe("c");
    expect(list.findRowElement(99)).toBeNull();
  });

  test("OV-03 a 2000-row list only mounts the visible band plus overscan, and the window slides on scroll", () => {
    const container = makeContainer();
    const items = Array.from({ length: 2000 }, (_, i) => `row-${i}`);
    const list = createVirtualList<string>({
      container,
      rowHeight: 36,
      overscan: 4,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 360, // 10 visible rows at 36px
    });

    list.setItems(items);
    // start = max(0, floor(0/36) - 4) = 0; end = min(2000, 0 + 10 + 8) = 18
    let indices = renderedIndices(container);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(17);
    expect(indices.length).toBeLessThan(items.length);

    container.scrollTop = 3600; // 100 rows down
    container.dispatchEvent(new Event("scroll"));
    indices = renderedIndices(container);
    // start = max(0, floor(3600/36) - 4) = 96; end = min(2000, 96 + 10 + 8) = 114
    expect(indices[0]).toBe(96);
    expect(indices[indices.length - 1]).toBe(113);

    const [top, , bottom] = Array.from(container.querySelectorAll<HTMLElement>(":scope > *"));
    expect(top?.style.height).toBe(`${96 * 36}px`);
    expect(bottom?.style.height).toBe(`${(2000 - 114) * 36}px`);
  });

  test("OV-04 render() re-applies the current window without changing items (e.g. after a manual scrollTop write)", () => {
    const container = makeContainer();
    const items = Array.from({ length: 50 }, (_, i) => `row-${i}`);
    const list = createVirtualList<string>({
      container,
      rowHeight: 20,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 100,
    });
    list.setItems(items);
    expect(renderedIndices(container)[0]).toBe(0);

    container.scrollTop = 200;
    list.render();
    expect(renderedIndices(container)[0]).toBe(0); // start = max(0, 10 - 10) = 0
  });

  test("OV-05 destroy() stops reacting to scroll events", () => {
    const container = makeContainer();
    let renderCalls = 0;
    const list = createVirtualList<string>({
      container,
      rowHeight: 20,
      renderRow: (item) => {
        renderCalls++;
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 100,
    });
    list.setItems(["a", "b", "c"]);
    const callsAfterFirstRender = renderCalls;

    list.destroy();
    container.scrollTop = 500;
    container.dispatchEvent(new Event("scroll"));

    expect(renderCalls).toBe(callsAfterFirstRender);
  });

  test("OV-06 defaults overscan and reads container.clientHeight when getViewportHeight is omitted", () => {
    const container = makeContainer();
    const list = createVirtualList<string>({
      container,
      rowHeight: 20,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
    });

    // happy-dom never lays elements out, so clientHeight is 0 — the default fallback
    // still must run without throwing, rendering purely off the overscan band.
    expect(() => list.setItems(["a", "b", "c"])).not.toThrow();
    expect(renderedIndices(container)).toEqual([0, 1, 2]);
  });

  test("OV-07 setItems() with a new item array resets scroll so a shrunk list still renders", () => {
    const container = makeContainer();
    const bigItems = Array.from({ length: 2000 }, (_, i) => `row-${i}`);
    const list = createVirtualList<string>({
      container,
      rowHeight: 36,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 360,
    });

    list.setItems(bigItems);
    container.scrollTop = 1900 * 36; // scrolled deep into the list
    container.dispatchEvent(new Event("scroll"));
    expect(renderedIndices(container).length).toBeGreaterThan(0);

    // Filtering down to a short list is a *new* array — old code left scrollTop deep,
    // which drove start (~1890) past end (3) and rendered zero rows.
    list.setItems(["only", "three", "rows"]);

    expect(renderedIndices(container)).toEqual([0, 1, 2]);
    expect(container.scrollTop).toBe(0);
  });

  test("OV-08 windowBounds() clamps a stale deep scrollTop even without a setItems() call", () => {
    const container = makeContainer();
    const items: string[] = Array.from({ length: 2000 }, (_, i) => `row-${i}`);
    const list = createVirtualList<string>({
      container,
      rowHeight: 36,
      overscan: 4,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 360,
    });

    list.setItems(items);
    container.scrollTop = 1900 * 36;
    container.dispatchEvent(new Event("scroll"));

    // Same array reference, shrunk in place — setItems() is never re-called, so its scroll
    // reset can't run here; only windowBounds()'s own clamp against items.length can save
    // this render() from computing start > end and rendering nothing.
    items.length = 3;
    list.render();

    expect(renderedIndices(container)).toEqual([0, 1, 2]);
  });

  test("OV-09 render() restores focus to the previously-focused row when it's still in the rendered window", () => {
    const container = makeContainer();
    const items = Array.from({ length: 20 }, (_, i) => `row-${i}`);
    const list = createVirtualList<string>({
      container,
      rowHeight: 20,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.tabIndex = 0;
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 200,
    });
    list.setItems(items);

    list.findRowElement(3)?.focus();
    expect(document.activeElement).toBe(list.findRowElement(3));

    // A scroll-triggered re-render rebuilds every row element via replaceChildren; the row
    // at index 3 is still inside the window, so focus must follow it to the new element
    // rather than dropping to <body> (which would break roving-tabindex j/k nav).
    container.dispatchEvent(new Event("scroll"));

    expect(document.activeElement).toBe(list.findRowElement(3));
  });

  test("OV-10 render() does not force focus onto a row when nothing was focused", () => {
    const container = makeContainer();
    const items = Array.from({ length: 5 }, (_, i) => `row-${i}`);
    const list = createVirtualList<string>({
      container,
      rowHeight: 20,
      renderRow: (item) => {
        const row = document.createElement("div");
        row.tabIndex = 0;
        row.textContent = item;
        return row;
      },
      getViewportHeight: () => 200,
    });
    list.setItems(items);

    expect(document.activeElement).toBe(document.body);
    container.dispatchEvent(new Event("scroll"));
    expect(document.activeElement).toBe(document.body);
  });
});
