import {
  BULK_REPLY_LIMIT_BOUNDS,
  bulkReplyLimit as defaultBulkReplyLimit,
  type BulkReplyLimit,
} from "../../lib/bulk-reply-limit";

type PaneHandle = { destroy(): void };

export async function renderBulkActionsPane(
  container: HTMLElement,
  opts: { limit?: BulkReplyLimit } = {},
): Promise<PaneHandle> {
  const limit = opts.limit ?? defaultBulkReplyLimit;
  let activeLimit = await limit.read();
  let commitGeneration = 0;

  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-pane-form";

  const header = document.createElement("div");
  header.className = "xb-opt-pane-header";
  const title = document.createElement("h1");
  title.textContent = "Bulk actions";
  const description = document.createElement("p");
  description.textContent = "Work limits for Reply Rail block and mute runs.";
  header.append(title, description);

  const card = document.createElement("div");
  card.className = "xb-opt-card";
  const row = document.createElement("div");
  row.className = "xb-opt-row";

  const copy = document.createElement("span");
  copy.className = "xb-opt-row-copy";
  const label = document.createElement("span");
  label.className = "xb-opt-row-title";
  label.textContent = "Bulk reply limit";
  const caption = document.createElement("span");
  caption.className = "xb-opt-row-caption";
  caption.textContent = "Skipped and failed replies count toward this work limit.";
  copy.append(label, caption);

  const control = document.createElement("div");
  control.className = "xb-opt-slider-row";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "xb-opt-slider";
  slider.min = String(BULK_REPLY_LIMIT_BOUNDS.min);
  slider.max = String(BULK_REPLY_LIMIT_BOUNDS.max);
  slider.value = String(activeLimit);
  slider.setAttribute("aria-label", "Bulk reply limit (slider)");

  const numberInput = document.createElement("input");
  numberInput.type = "number";
  numberInput.className = "xb-opt-number";
  numberInput.min = String(BULK_REPLY_LIMIT_BOUNDS.min);
  numberInput.max = String(BULK_REPLY_LIMIT_BOUNDS.max);
  numberInput.value = String(activeLimit);
  numberInput.setAttribute("aria-label", "Bulk reply limit");
  control.append(slider, numberInput);
  row.append(copy, control);
  card.appendChild(row);

  const feedback = document.createElement("p");
  feedback.className = "xb-opt-field-caption";
  feedback.dataset.tone = "danger";
  feedback.hidden = true;

  function renderValue(value: number): void {
    slider.value = String(value);
    numberInput.value = String(value);
  }

  function showError(message: string): void {
    feedback.textContent = message;
    feedback.hidden = false;
  }

  async function commit(candidate: number): Promise<void> {
    const generation = ++commitGeneration;
    feedback.hidden = true;
    try {
      const saved = await limit.set(candidate);
      activeLimit = saved;
      if (generation === commitGeneration) renderValue(saved);
    } catch {
      if (generation === commitGeneration) {
        renderValue(activeLimit);
        showError("Couldn’t save limit.");
      }
    }
  }

  slider.addEventListener("input", () => {
    numberInput.value = slider.value;
    feedback.hidden = true;
  });
  slider.addEventListener("change", () => {
    void commit(Number(slider.value));
  });
  numberInput.addEventListener("change", () => {
    const candidate = numberInput.value.trim() === "" ? Number.NaN : Number(numberInput.value);
    if (!Number.isFinite(candidate)) {
      renderValue(activeLimit);
      showError(
        `Enter a number from ${BULK_REPLY_LIMIT_BOUNDS.min} to ${BULK_REPLY_LIMIT_BOUNDS.max}.`,
      );
      return;
    }
    void commit(candidate);
  });

  wrapper.append(header, card, feedback);
  container.replaceChildren(wrapper);
  return { destroy() {} };
}
