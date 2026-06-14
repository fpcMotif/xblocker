import { createIcon, type IconType } from "./icons";

export type ActionButtonConfig = {
  action: string;
  icon: IconType;
  label: string;
  onClick: (button: HTMLButtonElement) => Promise<void> | void;
};

const STATE_RESET_MS = 1400;

export function createActionButton(config: ActionButtonConfig): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "xb-btn";
  button.dataset.action = config.action;
  button.dataset.state = "idle";
  button.setAttribute("aria-label", config.label);
  button.title = config.label;

  const main = document.createElement("span");
  main.className = "xb-icon xb-icon-main";
  main.appendChild(createIcon(config.icon));

  const status = document.createElement("span");
  status.className = "xb-icon xb-icon-status";

  button.appendChild(main);
  button.appendChild(status);

  button.addEventListener("click", () => {
    void runButtonAction(button, status, config);
  });

  return button;
}

export type LabeledActionButtonConfig = ActionButtonConfig & {
  text: string;
  variant?: "hero" | "secondary";
  count?: number;
};

/** A labeled bulk-action button that owns its count chip and progress state. */
export interface LabeledActionButton extends HTMLButtonElement {
  /** Show the chip with `count`, or hide it (and drop it from the a11y tree) at 0. */
  setCount(count: number): void;
  /** Swap the label for a live `done / total` readout and drive the fill. */
  setProgress(done: number, total: number): void;
  /** Restore the resting label and clear the fill. */
  clearProgress(): void;
}

export function createLabeledActionButton(config: LabeledActionButtonConfig): LabeledActionButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "xb-btn xb-btn-labeled";
  button.dataset.action = config.action;
  button.dataset.variant = config.variant ?? "secondary";
  button.dataset.state = "idle";
  button.setAttribute("aria-label", config.label);
  button.title = config.label;

  const iconWrap = document.createElement("span");
  iconWrap.className = "xb-btn-icon";
  const main = document.createElement("span");
  main.className = "xb-icon xb-icon-main";
  main.appendChild(createIcon(config.icon));
  const status = document.createElement("span");
  status.className = "xb-icon xb-icon-status";
  iconWrap.append(main, status);

  const label = config.text;
  const text = document.createElement("span");
  text.className = "xb-btn-text";
  text.textContent = label;

  const chip = document.createElement("span");
  chip.className = "xb-count";

  button.append(iconWrap, text, chip);
  button.addEventListener("click", () => {
    void runButtonAction(button, status, config);
  });

  const labeled: LabeledActionButton = Object.assign(button, {
    setCount(count: number): void {
      if (count > 0) {
        chip.textContent = String(count);
        chip.hidden = false;
        chip.removeAttribute("aria-hidden");
      } else {
        chip.textContent = "";
        chip.hidden = true;
        chip.setAttribute("aria-hidden", "true");
      }
    },
    setProgress(done: number, total: number): void {
      text.textContent = `${done} / ${total}`;
      button.style.setProperty("--xb-progress", String(done / total));
      button.dataset.progress = "true";
    },
    clearProgress(): void {
      text.textContent = label;
      button.style.removeProperty("--xb-progress");
      button.removeAttribute("data-progress");
    },
  });
  labeled.setCount(config.count ?? 0);
  return labeled;
}

async function runButtonAction(
  button: HTMLButtonElement,
  status: HTMLSpanElement,
  config: ActionButtonConfig,
): Promise<void> {
  if (button.dataset.state !== "idle") {
    return;
  }

  button.dataset.state = "busy";
  button.setAttribute("aria-busy", "true");
  status.replaceChildren(createIcon("loading"));

  try {
    await config.onClick(button);
    status.replaceChildren(createIcon("check"));
    button.dataset.state = "success";
  } catch (error) {
    console.warn(`XBlocker action "${config.action}" failed:`, error);
    status.replaceChildren(createIcon("cross"));
    button.dataset.state = "error";
  }

  button.removeAttribute("aria-busy");
  setTimeout(() => {
    button.dataset.state = "idle";
  }, STATE_RESET_MS);
}
