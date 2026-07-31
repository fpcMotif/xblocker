// General pane: the three behavior switches + the max-replies slider/numeric pair, all
// persisted under the popup's existing 4-key settings blob (SETTINGS_KEY) so this page and
// the popup read/write the exact same storage shape.

import { storageSet, SETTINGS_KEY } from "../../../packages/storage/chrome-storage";
import {
  clampMaxReplies,
  MAX_REPLIES_LIMIT,
  normalizeSettings,
  readSettings,
  type Settings,
} from "../../../packages/storage/settings";
import { watchStorage } from "../storage-watch";

type BooleanSettingKey = "protectWhitelist" | "confirmDestructiveActions" | "keyboardMode";

function saveSettings(settings: Settings): void {
  void storageSet({ [SETTINGS_KEY]: settings });
}

type PaneHandle = { destroy(): void };

export async function renderGeneralPane(container: HTMLElement): Promise<PaneHandle> {
  const settings = await readSettings();

  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-pane-form";

  const header = document.createElement("div");
  header.className = "xb-opt-pane-header";
  const h1 = document.createElement("h1");
  h1.textContent = "General";
  const desc = document.createElement("p");
  desc.textContent = "Core behavior for block and mute runs from the reply rail.";
  header.append(h1, desc);

  const switchesCard = document.createElement("div");
  switchesCard.className = "xb-opt-card";

  const switchInputs: Partial<Record<BooleanSettingKey, HTMLInputElement>> = {};

  const rows: Array<[BooleanSettingKey, string, string]> = [
    [
      "protectWhitelist",
      "Protect whitelist",
      "Whitelisted handles are skipped during bulk actions.",
    ],
    [
      "confirmDestructiveActions",
      "Confirm destructive actions",
      "Ask before removing whitelist entries.",
    ],
    ["keyboardMode", "Keyboard mode", "Reserved for upcoming j/k navigation in the reply rail."],
  ];

  for (const [key, label, caption] of rows) {
    const row = document.createElement("label");
    row.className = "xb-opt-row";

    const copy = document.createElement("span");
    copy.className = "xb-opt-row-copy";
    const title = document.createElement("span");
    title.className = "xb-opt-row-title";
    title.textContent = label;
    const captionEl = document.createElement("span");
    captionEl.className = "xb-opt-row-caption";
    captionEl.textContent = caption;
    copy.append(title, captionEl);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "xb-opt-switch";
    input.checked = settings[key];
    input.addEventListener("change", () => {
      settings[key] = input.checked;
      saveSettings(settings);
    });
    switchInputs[key] = input;

    row.append(copy, input);
    switchesCard.appendChild(row);
  }

  const maxRepliesCard = document.createElement("div");
  maxRepliesCard.className = "xb-opt-card";

  const maxRepliesRow = document.createElement("div");
  maxRepliesRow.className = "xb-opt-row";

  const maxRepliesCopy = document.createElement("span");
  maxRepliesCopy.className = "xb-opt-row-copy";
  const maxRepliesTitle = document.createElement("span");
  maxRepliesTitle.className = "xb-opt-row-title";
  maxRepliesTitle.textContent = "Max replies per run";
  const maxRepliesCaption = document.createElement("span");
  maxRepliesCaption.className = "xb-opt-row-caption";
  maxRepliesCaption.textContent = `Cap on accounts processed per bulk action, 1–${MAX_REPLIES_LIMIT}.`;
  maxRepliesCopy.append(maxRepliesTitle, maxRepliesCaption);

  const sliderRow = document.createElement("div");
  sliderRow.className = "xb-opt-slider-row";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "xb-opt-slider";
  slider.min = "1";
  slider.max = String(MAX_REPLIES_LIMIT);
  slider.value = String(settings.maxReplies);
  slider.setAttribute("aria-label", "Max replies per run (slider)");

  const numberInput = document.createElement("input");
  numberInput.type = "number";
  numberInput.className = "xb-opt-number";
  numberInput.min = "1";
  numberInput.max = String(MAX_REPLIES_LIMIT);
  numberInput.value = String(settings.maxReplies);
  numberInput.setAttribute("aria-label", "Max replies per run");

  function commitMaxReplies(value: unknown): void {
    const clamped = clampMaxReplies(value);
    settings.maxReplies = clamped;
    slider.value = String(clamped);
    numberInput.value = String(clamped);
    saveSettings(settings);
  }

  slider.addEventListener("input", () => commitMaxReplies(slider.value));
  numberInput.addEventListener("change", () => commitMaxReplies(numberInput.value));

  sliderRow.append(slider, numberInput);
  maxRepliesRow.append(maxRepliesCopy, sliderRow);
  maxRepliesCard.appendChild(maxRepliesRow);

  wrapper.append(header, switchesCard, maxRepliesCard);
  container.replaceChildren(wrapper);

  // Live-sync FROM storage: a popup edit made while this pane is mounted should be
  // reflected here without requiring a re-navigate. Writes this pane itself makes land
  // back here as a no-op re-render of the same values.
  const unsubscribe = watchStorage((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    const next = normalizeSettings(change.newValue);
    settings.protectWhitelist = next.protectWhitelist;
    settings.confirmDestructiveActions = next.confirmDestructiveActions;
    settings.keyboardMode = next.keyboardMode;
    settings.maxReplies = next.maxReplies;
    for (const [key] of rows) {
      const input = switchInputs[key];
      if (input) input.checked = settings[key];
    }
    slider.value = String(settings.maxReplies);
    numberInput.value = String(settings.maxReplies);
  });

  return {
    destroy() {
      unsubscribe();
    },
  };
}
