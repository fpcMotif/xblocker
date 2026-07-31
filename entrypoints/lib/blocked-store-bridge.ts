import type { RecordInput } from "./blocked-merge";
import { blockedStore } from "./blocked-store";

const RECORD_MESSAGE = "xblocker:record-blocked-action";

type RecordMessage = { type: typeof RECORD_MESSAGE; input: RecordInput };
type RecordResponse = { ok: true } | { ok: false; error: string };
type SendMessage = (message: RecordMessage) => Promise<RecordResponse>;

function defaultSendMessage(): SendMessage | undefined {
  if (typeof chrome.runtime.sendMessage !== "function") return undefined;
  return (message) => chrome.runtime.sendMessage<RecordMessage, RecordResponse>(message);
}

/** Content scripts do not share the extension origin's Web Locks. Route their only
 * ledger mutation through the background owner so every read-modify-write participates
 * in the same extension-origin lock as sync, wipe, popup, and settings work. */
export async function recordBlockedAction(
  input: RecordInput,
  sendMessage: SendMessage | undefined = defaultSendMessage(),
): Promise<void> {
  if (!sendMessage) {
    await blockedStore.record(input);
    return;
  }

  const response = await sendMessage({ type: RECORD_MESSAGE, input });
  if (!response.ok) throw new Error(response.error);
}

function isRecordMessage(value: unknown): value is RecordMessage {
  if (typeof value !== "object" || value === null || !("type" in value) || !("input" in value)) {
    return false;
  }
  if (value.type !== RECORD_MESSAGE || typeof value.input !== "object" || value.input === null) {
    return false;
  }
  const input = value.input;
  return (
    "handle" in input &&
    typeof input.handle === "string" &&
    "kind" in input &&
    (input.kind === "block" || input.kind === "mute" || input.kind === "unblock") &&
    "source" in input &&
    (input.source === "reply-bar" ||
      input.source === "popup" ||
      input.source === "import" ||
      input.source === "background")
  );
}

export async function handleBlockedStoreMessage(message: unknown): Promise<RecordResponse | null> {
  if (!isRecordMessage(message)) return null;
  try {
    await blockedStore.record(message.input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function installBlockedStoreMessageHandler(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRecordMessage(message)) return false;
    void handleBlockedStoreMessage(message).then(sendResponse);
    return true;
  });
}
