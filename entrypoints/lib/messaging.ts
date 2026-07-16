// The content↔background message contract. The reply rail lives in a content script, which
// cannot call chrome.runtime.openOptionsPage; it posts OPEN_OPTIONS_MESSAGE_TYPE and the
// background worker opens the page. Both ends import this one constant + guard so the wire
// string can never drift on one side while the other keeps the old spelling — the same
// centralize-the-vocabulary discipline x-dom.ts uses for X's DOM selectors.

export const OPEN_OPTIONS_MESSAGE_TYPE = "xb-open-options";

export type OpenOptionsMessage = { type: typeof OPEN_OPTIONS_MESSAGE_TYPE };

/** Narrow an arbitrary runtime message to the rail's "open the options page" request. */
export function isOpenOptionsMessage(message: unknown): message is OpenOptionsMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    Reflect.get(message, "type") === OPEN_OPTIONS_MESSAGE_TYPE
  );
}
