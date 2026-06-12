import { addToWhitelist, normalizeUsername } from "./actions";
import { detectTheme } from "./theme";
import { showToast } from "./toast";

const MODAL_ID = "xblocker-modal";

export function showWhitelistModal(): void {
  document.getElementById(MODAL_ID)?.remove();

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

  const closeModal = () => {
    backdrop.dataset.state = "closed";
    setTimeout(() => backdrop.remove(), 160);
    document.removeEventListener("keydown", onKeydown);
  };

  const submit = async () => {
    const username = normalizeUsername(input.value.trim());
    if (!username) {
      return;
    }
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
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeModal();
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
  input.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      void submit();
    }
  });
  document.addEventListener("keydown", onKeydown);
}
