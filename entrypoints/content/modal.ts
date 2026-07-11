import { addToWhitelist, normalizeUsername } from "./actions";
import { detectTheme } from "./theme";
import { showToast } from "./toast";

const MODAL_ID = "xblocker-modal";

// Shared by the setTimeout below and interpolated into styles.ts's backdrop
// transition, so the node is never removed mid-fade (or, previously, well
// after the panel's slower transition had already finished).
export const MODAL_EXIT_MS = 200;

export function showWhitelistModal(): void {
  document.getElementById(MODAL_ID)?.remove();

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement("div");
  backdrop.id = MODAL_ID;
  backdrop.className = "xb-root xb-modal-backdrop";
  backdrop.dataset.xbTheme = detectTheme();
  backdrop.dataset.state = "closed";

  const modal = document.createElement("div");
  modal.className = "xb-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Add user to whitelist");
  modal.innerHTML = `
		<h3>Add user to whitelist</h3>
		<p>Whitelisted users are never blocked or muted.</p>`;

  const input = document.createElement("input");
  input.type = "text";
  input.id = "xb-username-input";
  input.placeholder = "Username, without @";
  input.autocomplete = "off";
  input.spellcheck = false;

  const actions = document.createElement("div");
  actions.className = "xb-modal-actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "xb-modal-cancel";
  cancelButton.textContent = "Cancel";
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "xb-modal-confirm";
  confirmButton.textContent = "Add to whitelist";
  actions.appendChild(cancelButton);
  actions.appendChild(confirmButton);
  modal.appendChild(input);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => {
    backdrop.dataset.state = "open";
  });

  input.focus();

  let submitting = false;
  let closed = false;

  const closeModal = () => {
    // A submit begun before the user dismissed the modal (Escape/Cancel/backdrop)
    // can still be in flight and resolve afterward; without this guard its own
    // closeModal() call would run the teardown again and steal focus back to
    // previouslyFocused even though the user has since focused something else.
    if (closed) {
      return;
    }
    closed = true;
    backdrop.dataset.state = "closed";
    setTimeout(() => backdrop.remove(), MODAL_EXIT_MS);
    document.removeEventListener("keydown", onKeydown);
    // Screen-reader focus shouldn't linger on a node that's on its way out;
    // hand it back to whatever opened the modal (the rail's whitelist button).
    previouslyFocused?.focus();
  };

  const submit = async () => {
    // Mirrors buttons.ts's runButtonAction reentry guard (a state flag checked
    // before the first await, not native `disabled` — a disabled button drops
    // dispatched clicks entirely, including a keyboard-driven Enter re-submit
    // routed through a still-enabled input): a second Enter/click while
    // addToWhitelist is in flight must not fire a second write.
    if (submitting) {
      return;
    }
    const username = normalizeUsername(input.value.trim());
    if (!username) {
      return;
    }
    submitting = true;
    try {
      const result = await addToWhitelist(username);
      if (result === "added") {
        showToast(`Added @${username} to whitelist`, "success");
      } else if (result === "exists") {
        showToast(`@${username} is already in the whitelist`, "warning");
      } else {
        // The whitelist read failed and nothing was written; keep the modal
        // open so the user can retry.
        showToast("Could not update the whitelist. Try again.", "warning");
        return;
      }
      closeModal();
    } finally {
      submitting = false;
    }
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeModal();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    // Focus trap: Tab/Shift+Tab cycle inside the dialog instead of escaping to
    // the host page behind the backdrop. Input and Confirm are the two ends
    // of the fixed three-control layout (input, Cancel, Confirm).
    const first = input;
    const last = confirmButton;
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !modal.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !modal.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  cancelButton.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });
  confirmButton.addEventListener("click", () => {
    void submit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void submit();
    }
  });
  document.addEventListener("keydown", onKeydown);
}
