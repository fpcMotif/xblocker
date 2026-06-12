import { detectTheme } from "./theme";

export type ToastType = "info" | "success" | "warning";

const TOAST_DURATION_MS = 3000;
const TOAST_EXIT_MS = 180;

export function showToast(message: string, type: ToastType = "info"): void {
  const toast = document.createElement("div");
  toast.className = "xb-root xb-toast";
  toast.dataset.xbTheme = detectTheme();
  toast.dataset.type = type;
  toast.dataset.state = "closed";
  toast.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "xb-toast-dot";
  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(dot);
  toast.appendChild(text);
  document.body.appendChild(toast);

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
}
