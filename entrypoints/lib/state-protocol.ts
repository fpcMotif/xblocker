// Versioned MV3 request boundary. Keep this narrow: one worker owns every mutation.

import type { LedgerRecord, SettingsPatch, StateService } from "./state-client";

export const STATE_PROTOCOL_VERSION = 1;
const REQUEST_TYPE = "xblocker.state.request";
const RESPONSE_TYPE = "xblocker.state.response";
const BLOCK_KINDS = new Set(["block", "mute", "unblock"]);
const BLOCK_SOURCES = new Set(["reply-bar", "popup", "import", "background"]);
const SETTINGS_KEYS = new Set([
  "protectWhitelist",
  "confirmDestructiveActions",
  "keyboardMode",
  "maxReplies",
]);
const ERROR_CODES = new Set(["BAD_REQUEST", "BAD_RESPONSE", "FAILED", "FORBIDDEN"]);
const RECORD_INPUT_KEYS = new Set([
  "actionId",
  "at",
  "handle",
  "kind",
  "source",
  "xUserId",
  "fromAccount",
]);

export type StateCommand =
  | { type: "ledger.hasActiveHandle"; handle: string }
  | { type: "ledger.record"; input: LedgerRecord }
  | { type: "ledger.list" }
  | { type: "ledger.stats" }
  | { type: "ledger.pending" }
  | { type: "whitelist.list" }
  | { type: "whitelist.add"; handle: string }
  | { type: "whitelist.remove"; handle: string }
  | { type: "whitelist.addMany"; handles: string[] }
  | { type: "settings.read" }
  | { type: "settings.update"; patch: SettingsPatch }
  | { type: "cloud.inspect" }
  | { type: "cloud.setEnabled"; enabled: boolean }
  | { type: "cloud.sync"; mode: "manual" | "auto" }
  | { type: "cloud.wipe"; wipeId: string };

export type StateRequest = {
  version: typeof STATE_PROTOCOL_VERSION;
  type: typeof REQUEST_TYPE;
  id: string;
  command: StateCommand;
};

export type StateErrorCode = "BAD_REQUEST" | "BAD_RESPONSE" | "FAILED" | "FORBIDDEN";
export type StateError = { code: StateErrorCode; message: string };
export type StateResponse =
  | {
      version: typeof STATE_PROTOCOL_VERSION;
      type: typeof RESPONSE_TYPE;
      id: string;
      ok: true;
      value: unknown;
    }
  | {
      version: typeof STATE_PROTOCOL_VERSION;
      type: typeof RESPONSE_TYPE;
      id: string;
      ok: false;
      error: StateError;
    };

export class StateProtocolFailure extends Error {
  constructor(
    public readonly code: StateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StateProtocolFailure";
  }
}

type UnknownRecord = Record<string, unknown>;
type Sender = { id?: string; url?: string; frameId?: number; tab?: { url?: string } };
type Listener = (
  message: unknown,
  sender: Sender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;
type Runtime = {
  onMessage: { addListener(listener: Listener): void; removeListener(listener: Listener): void };
};

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactly(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || string(value);
}

function isRecordInput(value: unknown): value is LedgerRecord {
  if (!record(value)) return false;
  if (!Object.keys(value).every((key) => RECORD_INPUT_KEYS.has(key))) return false;
  return (
    string(value.actionId) &&
    value.actionId.length > 0 &&
    finiteNumber(value.at) &&
    string(value.handle) &&
    string(value.kind) &&
    BLOCK_KINDS.has(value.kind) &&
    string(value.source) &&
    BLOCK_SOURCES.has(value.source) &&
    optionalString(value.xUserId) &&
    optionalString(value.fromAccount)
  );
}

function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (!record(value)) return false;
  if (!Object.keys(value).every((key) => SETTINGS_KEYS.has(key))) return false;
  return (
    (value.protectWhitelist === undefined || typeof value.protectWhitelist === "boolean") &&
    (value.confirmDestructiveActions === undefined ||
      typeof value.confirmDestructiveActions === "boolean") &&
    (value.keyboardMode === undefined || typeof value.keyboardMode === "boolean") &&
    (value.maxReplies === undefined || finiteNumber(value.maxReplies))
  );
}

function parseCommand(value: unknown): StateCommand | undefined {
  if (!record(value) || !string(value.type)) return undefined;
  switch (value.type) {
    case "ledger.hasActiveHandle":
      return exactly(value, ["type", "handle"]) && string(value.handle)
        ? { type: value.type, handle: value.handle }
        : undefined;
    case "ledger.record":
      return exactly(value, ["type", "input"]) && isRecordInput(value.input)
        ? { type: value.type, input: value.input }
        : undefined;
    case "ledger.list":
    case "ledger.stats":
    case "ledger.pending":
    case "whitelist.list":
    case "settings.read":
    case "cloud.inspect":
      return exactly(value, ["type"]) ? { type: value.type } : undefined;
    case "whitelist.add":
    case "whitelist.remove":
      return exactly(value, ["type", "handle"]) && string(value.handle)
        ? { type: value.type, handle: value.handle }
        : undefined;
    case "whitelist.addMany":
      return exactly(value, ["type", "handles"]) &&
        Array.isArray(value.handles) &&
        value.handles.every(string)
        ? { type: value.type, handles: value.handles }
        : undefined;
    case "settings.update":
      return exactly(value, ["type", "patch"]) && isSettingsPatch(value.patch)
        ? { type: value.type, patch: value.patch }
        : undefined;
    case "cloud.setEnabled":
      return exactly(value, ["type", "enabled"]) && typeof value.enabled === "boolean"
        ? { type: value.type, enabled: value.enabled }
        : undefined;
    case "cloud.sync":
      return exactly(value, ["type", "mode"]) && (value.mode === "manual" || value.mode === "auto")
        ? { type: value.type, mode: value.mode }
        : undefined;
    case "cloud.wipe":
      return exactly(value, ["type", "wipeId"]) && string(value.wipeId) && value.wipeId.length > 0
        ? { type: value.type, wipeId: value.wipeId }
        : undefined;
    default:
      return undefined;
  }
}

function parseRequest(value: unknown): StateRequest | undefined {
  if (!record(value) || !exactly(value, ["version", "type", "id", "command"])) return undefined;
  if (
    value.version !== STATE_PROTOCOL_VERSION ||
    value.type !== REQUEST_TYPE ||
    !string(value.id) ||
    value.id.length === 0
  )
    return undefined;
  const command = parseCommand(value.command);
  return command
    ? { version: STATE_PROTOCOL_VERSION, type: REQUEST_TYPE, id: value.id, command }
    : undefined;
}

function newId(): string {
  return crypto.randomUUID();
}

export function makeStateRequest(command: StateCommand): StateRequest {
  return { version: STATE_PROTOCOL_VERSION, type: REQUEST_TYPE, id: newId(), command };
}

function isResponseValue(command: StateCommand["type"], value: unknown): boolean {
  switch (command) {
    case "ledger.hasActiveHandle":
      return typeof value === "boolean";
    case "cloud.setEnabled":
    case "whitelist.remove":
      return value === undefined;
    case "ledger.list":
    case "ledger.pending":
    case "whitelist.list":
      return Array.isArray(value);
    case "ledger.stats":
    case "ledger.record":
    case "settings.read":
    case "settings.update":
    case "cloud.inspect":
    case "cloud.sync":
    case "cloud.wipe":
    case "whitelist.addMany":
      return record(value);
    case "whitelist.add":
      return value === "added" || value === "error" || value === "exists" || value === "invalid";
    default:
      return false;
  }
}

function isStateErrorCode(value: unknown): value is StateErrorCode {
  return string(value) && ERROR_CODES.has(value);
}

export function parseStateResponse(
  value: unknown,
  id: string,
  command: StateCommand["type"],
): StateResponse {
  if (
    !record(value) ||
    value.version !== STATE_PROTOCOL_VERSION ||
    value.type !== RESPONSE_TYPE ||
    value.id !== id
  ) {
    throw new StateProtocolFailure("BAD_RESPONSE", "Invalid state response.");
  }
  if (value.ok === true && exactly(value, ["version", "type", "id", "ok", "value"])) {
    if (!isResponseValue(command, value.value)) {
      throw new StateProtocolFailure("BAD_RESPONSE", "Invalid state response.");
    }
    return {
      version: STATE_PROTOCOL_VERSION,
      type: RESPONSE_TYPE,
      id,
      ok: true,
      value: value.value,
    };
  }
  if (
    value.ok === false &&
    exactly(value, ["version", "type", "id", "ok", "error"]) &&
    record(value.error) &&
    exactly(value.error, ["code", "message"]) &&
    string(value.error.code) &&
    isStateErrorCode(value.error.code) &&
    string(value.error.message)
  ) {
    return {
      version: STATE_PROTOCOL_VERSION,
      type: RESPONSE_TYPE,
      id,
      ok: false,
      error: { code: value.error.code, message: value.error.message },
    };
  }
  throw new StateProtocolFailure("BAD_RESPONSE", "Invalid state response.");
}

function allowed(sender: Sender, runtimeId: string, command: StateCommand): boolean {
  if (sender.id !== runtimeId) return false;
  if (!sender.tab) return true;
  const url = sender.tab.url ?? sender.url;
  if (sender.frameId !== 0 || !url || !/^https:\/\/(?:www\.)?x\.com\//.test(url)) return false;
  return new Set([
    "ledger.hasActiveHandle",
    "ledger.record",
    "whitelist.list",
    "whitelist.add",
    "settings.read",
  ]).has(command.type);
}

async function dispatch(service: StateService, command: StateCommand): Promise<unknown> {
  switch (command.type) {
    case "ledger.hasActiveHandle":
      return service.ledger.hasActiveHandle(command.handle);
    case "ledger.record":
      return service.ledger.record(command.input);
    case "ledger.list":
      return service.ledger.list();
    case "ledger.stats":
      return service.ledger.stats();
    case "ledger.pending":
      return service.ledger.pending();
    case "whitelist.list":
      return service.whitelist.list();
    case "whitelist.add":
      return service.whitelist.add(command.handle);
    case "whitelist.remove":
      return service.whitelist.remove(command.handle);
    case "whitelist.addMany":
      return service.whitelist.addMany(command.handles);
    case "settings.read":
      return service.settings.read();
    case "settings.update":
      return service.settings.update(command.patch);
    case "cloud.inspect":
      return service.cloud.inspect();
    case "cloud.setEnabled":
      return service.cloud.setEnabled(command.enabled);
    case "cloud.sync":
      return service.cloud.sync(command.mode);
    case "cloud.wipe":
      return service.cloud.wipe(command.wipeId);
    default:
      throw new Error("Unknown state command.");
  }
}

function response(
  id: string,
  result: { ok: true; value: unknown } | { ok: false; error: StateError },
): StateResponse {
  return result.ok
    ? { version: STATE_PROTOCOL_VERSION, type: RESPONSE_TYPE, id, ok: true, value: result.value }
    : { version: STATE_PROTOCOL_VERSION, type: RESPONSE_TYPE, id, ok: false, error: result.error };
}

/** Install one synchronous MV3 router. It owns sendResponse and always returns literal true. */
export function installStateProtocolListener(
  runtime: Runtime,
  service: StateService,
  runtimeId: string,
): () => void {
  const listener: Listener = (message, sender, sendResponse) => {
    const request = parseRequest(message);
    if (!request) return undefined;
    let replied = false;
    const reply = (result: { ok: true; value: unknown } | { ok: false; error: StateError }) => {
      if (replied) return;
      replied = true;
      sendResponse(response(request.id, result));
    };
    void (async () => {
      if (!allowed(sender, runtimeId, request.command)) {
        reply({
          ok: false,
          error: { code: "FORBIDDEN", message: "State command is not allowed." },
        });
        return;
      }
      try {
        reply({ ok: true, value: await dispatch(service, request.command) });
      } catch {
        reply({ ok: false, error: { code: "FAILED", message: "State command failed." } });
      }
    })();
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}

export { createRuntimeStateClient } from "./state-client";
export type { StateService } from "./state-client";
