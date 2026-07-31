import { describe, expect, test } from "bun:test";

import {
  STATE_PROTOCOL_VERSION,
  StateProtocolFailure,
  createRuntimeStateClient,
  installStateProtocolListener,
  type StateService,
} from "../entrypoints/lib/state-protocol.ts";

function service(): StateService {
  return {
    ledger: {
      hasActiveHandle: async (handle) => handle === "already-blocked",
      record: async (input) => ({
        key: input.xUserId ?? `@${input.handle}`,
        handle: input.handle,
        idUnknown: !input.xUserId,
        ...(input.xUserId ? { xUserId: input.xUserId } : {}),
        firstActionAt: input.at,
        lastActionAt: input.at,
        blockCount: input.kind === "block" ? 1 : 0,
        muteCount: input.kind === "mute" ? 1 : 0,
        status: input.kind === "unblock" ? "unblocked" : "active",
        actions: [],
      }),
      list: async () => [],
      stats: async () => ({ accounts: 0, blocked: 0, muted: 0 }),
      pending: async () => [],
    },
    whitelist: {
      list: async () => [],
      add: async () => "added",
      remove: async () => {},
      addMany: async () => ({ added: 0, skipped: 0, invalid: 0 }),
    },
    settings: {
      read: async () => ({
        protectWhitelist: true,
        confirmDestructiveActions: true,
        keyboardMode: false,
        maxReplies: 50,
      }),
      update: async (patch) => ({
        protectWhitelist: true,
        confirmDestructiveActions: true,
        keyboardMode: false,
        maxReplies: 50,
        ...patch,
      }),
    },
    cloud: {
      inspect: async () => ({ configured: true, enabled: false, pendingCount: 0 }),
      setEnabled: async () => {},
      sync: async () => ({ status: "synced", pushed: 0, pulled: 0, at: 1, generation: 0 }),
      wipe: async () => ({ status: "wiped", generation: 1 }),
    },
  };
}

function connect(sender: TestSender): ReturnType<typeof createRuntimeStateClient> {
  let listener:
    | ((
        message: unknown,
        sender: TestSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined)
    | undefined;

  installStateProtocolListener(
    { onMessage: { addListener: (next) => (listener = next), removeListener: () => {} } },
    service(),
    "extension-id",
  );

  return createRuntimeStateClient({
    sendMessage: (message) =>
      new Promise((resolve) => {
        expect(listener?.(message, sender, resolve)).toBe(true);
      }),
  });
}

type TestSender = { id?: string; url?: string; frameId?: number; tab?: { url?: string } };

describe("State protocol", () => {
  test("SP-01 content can record a caller-idempotent ledger action", () => {
    const client = connect({
      id: "extension-id",
      frameId: 0,
      tab: { url: "https://x.com/someone/status/1" },
    });

    return expect(
      client.ledger.record({
        actionId: "action-1",
        at: 123,
        handle: "someone",
        xUserId: "42",
        kind: "block",
        source: "reply-bar",
      }),
    ).resolves.toMatchObject({ key: "42", lastActionAt: 123 });
  });

  test("SP-02 content cannot mutate settings", () => {
    const client = connect({
      id: "extension-id",
      frameId: 0,
      tab: { url: "https://x.com/someone/status/1" },
    });

    return expect(client.settings.update({ keyboardMode: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("SP-03 content may read settings", () => {
    const client = connect({
      id: "extension-id",
      frameId: 0,
      tab: { url: "https://x.com/someone/status/1" },
    });

    return expect(client.settings.read()).resolves.toMatchObject({ maxReplies: 50 });
  });

  test("SP-04 a foreign extension cannot claim this worker", () => {
    const client = connect({
      id: "foreign-extension",
      frameId: 0,
      tab: { url: "https://x.com/someone/status/1" },
    });

    return expect(client.ledger.hasActiveHandle("someone")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("SP-05 rejects malformed responses before they reach a caller", () => {
    const client = createRuntimeStateClient({
      sendMessage: async () => ({
        version: STATE_PROTOCOL_VERSION,
        type: "xblocker.state.response",
        id: "wrong-request",
        ok: true,
        value: true,
      }),
    });

    return expect(client.ledger.hasActiveHandle("someone")).rejects.toBeInstanceOf(
      StateProtocolFailure,
    );
  });

  test("SP-06 unknown or non-exact traffic does not claim the message channel", () => {
    let listener:
      | ((
          message: unknown,
          sender: TestSender,
          sendResponse: (response: unknown) => void,
        ) => unknown)
      | undefined;
    installStateProtocolListener(
      { onMessage: { addListener: (next) => (listener = next), removeListener: () => {} } },
      service(),
      "extension-id",
    );

    expect(listener?.({ type: "other-extension" }, {}, () => {})).toBeUndefined();
    expect(
      listener?.(
        {
          version: STATE_PROTOCOL_VERSION,
          type: "xblocker.state.request",
          id: "request-1",
          command: { type: "ledger.list" },
          extra: true,
        },
        { id: "extension-id" },
        () => {},
      ),
    ).toBeUndefined();
  });
});
