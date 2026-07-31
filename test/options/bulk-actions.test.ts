import { beforeEach, describe, expect, test } from "bun:test";

import type { BulkReplyLimit } from "../../entrypoints/lib/bulk-reply-limit.ts";
import { renderBulkActionsPane } from "../../entrypoints/options/panes/bulk-actions.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment } from "../setup.ts";

function controls(): { slider: HTMLInputElement; number: HTMLInputElement } {
  return {
    slider: document.querySelector<HTMLInputElement>('[aria-label="Bulk reply limit (slider)"]')!,
    number: document.querySelector<HTMLInputElement>('[aria-label="Bulk reply limit"]')!,
  };
}

function fakeLimit(initial = 50): { limit: BulkReplyLimit; writes: number[] } {
  let current = initial;
  const writes: number[] = [];
  return {
    writes,
    limit: {
      read: async () => current,
      migrate: async () => current,
      set: async (candidate) => {
        writes.push(candidate);
        current = Math.min(200, Math.max(1, Math.trunc(candidate)));
        return current;
      },
    },
  };
}

beforeEach(() => {
  resetTestEnvironment();
});

describe("Bulk actions pane", () => {
  test("OBA-01 renders the active Bulk reply limit", async () => {
    const { limit } = fakeLimit(75);
    await renderBulkActionsPane(document.body, { limit });

    expect(document.querySelector("h1")?.textContent).toBe("Bulk actions");
    expect(controls().slider.value).toBe("75");
    expect(controls().number.value).toBe("75");
  });

  test("OBA-02 slider input previews without writing; change commits once", async () => {
    const { limit, writes } = fakeLimit();
    await renderBulkActionsPane(document.body, { limit });
    const { slider, number } = controls();

    slider.value = "80";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(number.value).toBe("80");
    expect(writes).toEqual([]);

    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();
    expect(writes).toEqual([80]);
  });

  test("OBA-03 numeric input commits a clamped value", async () => {
    const { limit, writes } = fakeLimit();
    await renderBulkActionsPane(document.body, { limit });
    const { slider, number } = controls();

    number.value = "999";
    number.dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(writes).toEqual([999]);
    expect(number.value).toBe("200");
    expect(slider.value).toBe("200");
  });

  test("OBA-04 blank input restores the active value and explains the range", async () => {
    const { limit, writes } = fakeLimit(75);
    await renderBulkActionsPane(document.body, { limit });
    const { number } = controls();

    number.value = "";
    number.dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(writes).toEqual([]);
    expect(number.value).toBe("75");
    expect(document.body.textContent).toContain("Enter a number from 1 to 200.");
  });

  test("OBA-05 rejected save restores the active value and reports failure", async () => {
    const { limit } = fakeLimit(60);
    limit.set = async () => {
      throw new Error("storage failed");
    };
    await renderBulkActionsPane(document.body, { limit });
    const { slider, number } = controls();

    number.value = "75";
    number.dispatchEvent(new Event("change", { bubbles: true }));
    await settleMicrotasks();

    expect(number.value).toBe("60");
    expect(slider.value).toBe("60");
    expect(document.body.textContent).toContain("Couldn’t save limit.");
  });
});
