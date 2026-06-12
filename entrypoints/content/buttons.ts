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
