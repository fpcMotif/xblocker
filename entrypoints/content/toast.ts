import { detectTheme } from "./theme";

export type ToastType = "info" | "success" | "warning";

const TOAST_DURATION_MS = 3000;
const TOAST_EXIT_MS = 180;
const TOAST_REGION_CLASS = "xb-toast-region";

// One fixed, persistent container: concurrent toasts stack in flex-column
// flow instead of each floating independently at the same fixed coordinate
// (where a second toast would render on top of the first).
function ensureToastRegion(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`.${TOAST_REGION_CLASS}`);
  if (existing) {
    return existing;
  }
  const region = document.createElement("div");
  region.className = `xb-root ${TOAST_REGION_CLASS}`;
  region.dataset.xbTheme = detectTheme();
  document.body.appendChild(region);
  return region;
}

export function showToast(message: string, type: ToastType = "info"): void {
  const region = ensureToastRegion();

  const toast = document.createElement("div");
  toast.className = "xb-root xb-toast";
  toast.dataset.xbTheme = detectTheme();
  toast.dataset.type = type;
  toast.dataset.state = "closed";
  toast.setAttribute("role", type === "warning" ? "alert" : "status");
  toast.tabIndex = 0;

  const dot = document.createElement("span");
  dot.className = "xb-toast-dot";
  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(dot);
  toast.appendChild(text);
  region.appendChild(toast);

  requestAnimationFrame(() => {
    toast.dataset.state = "open";
  });

  const dismiss = () => {
    toast.dataset.state = "closed";
    setTimeout(() => toast.remove(), TOAST_EXIT_MS);
  };

  const timer = setTimeout(dismiss, TOAST_DURATION_MS);
  toast.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
  toast.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "Escape") {
      clearTimeout(timer);
      dismiss();
    }
  });
}
