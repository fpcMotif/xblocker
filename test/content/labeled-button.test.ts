// Catalog: LB-* (labeled bulk-action button). Pins the contract the rail's
// "Block all" / "Mute all" buttons rely on: icon + visible text + a count chip
// that hides at zero, plus the on-button batch-progress readout.
import { beforeEach, describe, expect, test } from "bun:test";

import { createLabeledActionButton } from "../../entrypoints/content/buttons.ts";
import { settleMicrotasks } from "../helpers/timers.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("createLabeledActionButton", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("LB-01 renders icon, visible text, and a count chip; hero variant carries the count", () => {
    const button = createLabeledActionButton({
      action: "block",
      icon: "block",
      label: "Block all replies",
      text: "Block all",
      variant: "hero",
      count: 18,
      onClick: () => {},
    });

    expect(button.getAttribute("aria-label")).toBe("Block all replies");
    expect(button.dataset["variant"]).toBe("hero");
    expect(button.querySelector(".xb-btn-text")?.textContent).toBe("Block all");
    expect(button.querySelector(".xb-icon-main svg")).toBeTruthy();

    const chip = button.querySelector<HTMLElement>(".xb-count");
    expect(chip?.textContent).toBe("18");
    expect(chip?.hidden).toBe(false);
  });

  test("LB-02 defaults to the secondary variant and a hidden chip when count is omitted", () => {
    const button = createLabeledActionButton({
      action: "mute",
      icon: "mute",
      label: "Mute all replies",
      text: "Mute all",
      onClick: () => {},
    });

    expect(button.dataset["variant"]).toBe("secondary");
    const chip = button.querySelector<HTMLElement>(".xb-count");
    expect(chip?.hidden).toBe(true);
    expect(chip?.getAttribute("aria-hidden")).toBe("true");
    expect(chip?.textContent).toBe("");
  });

  test("LB-03 setCount(n>0) shows the chip; setCount(0) hides it from the a11y tree", () => {
    const button = createLabeledActionButton({
      action: "block",
      icon: "block",
      label: "Block all replies",
      text: "Block all",
      onClick: () => {},
    });
    const chip = button.querySelector<HTMLElement>(".xb-count");

    button.setCount(7);
    expect(chip?.textContent).toBe("7");
    expect(chip?.hidden).toBe(false);
    expect(chip?.hasAttribute("aria-hidden")).toBe(false);

    button.setCount(0);
    expect(chip?.hidden).toBe(true);
    expect(chip?.getAttribute("aria-hidden")).toBe("true");
    expect(chip?.textContent).toBe("");
  });

  test("LB-04 setProgress shows a live n/total readout and a fill; clearProgress restores the label", () => {
    const button = createLabeledActionButton({
      action: "block",
      icon: "block",
      label: "Block all replies",
      text: "Block all",
      onClick: () => {},
    });
    const text = button.querySelector<HTMLElement>(".xb-btn-text");

    button.setProgress(3, 10);
    expect(text?.textContent).toBe("3 / 10");
    expect(button.style.getPropertyValue("--xb-progress")).toBe("0.3");
    expect(button.dataset["progress"]).toBe("true");

    button.clearProgress();
    expect(text?.textContent).toBe("Block all");
    expect(button.style.getPropertyValue("--xb-progress")).toBe("");
    expect(button.hasAttribute("data-progress")).toBe(false);
  });

  test("LB-05 clicking runs the action and lands in the success state", async () => {
    let ran = false;
    const button = createLabeledActionButton({
      action: "block",
      icon: "block",
      label: "Block all replies",
      text: "Block all",
      onClick: () => {
        ran = true;
      },
    });

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleMicrotasks();

    expect(ran).toBe(true);
    expect(button.dataset["state"]).toBe("success");
    expect(button.querySelector(".xb-icon-status svg")).toBeTruthy();
  });
});
