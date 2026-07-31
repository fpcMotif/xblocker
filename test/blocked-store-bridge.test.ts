import { beforeEach, describe, expect, test } from "bun:test";

import {
  handleBlockedStoreMessage,
  installBlockedStoreMessageHandler,
  recordBlockedAction,
} from "../entrypoints/lib/blocked-store-bridge.ts";
import { blockedStore } from "../entrypoints/lib/blocked-store.ts";
import { resetTestEnvironment, storageFake } from "./setup.ts";

const input = { handle: "spammer", kind: "block", source: "reply-bar" } as const;
const message = { type: "xblocker:record-blocked-action", input } as const;

beforeEach(() => {
  resetTestEnvironment();
});

describe("content-to-background blocked-store bridge", () => {
  test("BB-01 content sends its mutation to the background owner", async () => {
    const sent: unknown[] = [];
    await recordBlockedAction(input, async (value) => {
      sent.push(value);
      return { ok: true };
    });

    expect(sent).toEqual([message]);
    expect(await blockedStore.list()).toEqual([]);
  });

  test("BB-02 a background rejection is surfaced to the best-effort content caller", async () => {
    const error = await recordBlockedAction(input, async () => ({ ok: false, error: "full" })).then(
      () => undefined,
      (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)),
    );
    expect(error).toBe("full");
  });

  test("BB-03 the non-extension fallback still records through the local store", async () => {
    await recordBlockedAction(input, undefined);
    expect(await blockedStore.get("@spammer")).toMatchObject({ blockCount: 1 });
  });

  test("BB-04 the default runtime sender is used when Chrome provides it", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake temporarily installs the runtime method absent from the shared test environment.
    const runtime = chrome.runtime as unknown as Record<string, unknown>;
    const original = runtime["sendMessage"];
    const sent: unknown[] = [];
    runtime["sendMessage"] = async (value: unknown) => {
      sent.push(value);
      return { ok: true };
    };
    try {
      await recordBlockedAction(input);
      expect(sent).toEqual([message]);
    } finally {
      runtime["sendMessage"] = original;
    }
  });

  test("BB-05 background validation ignores foreign messages and records valid ones", async () => {
    expect(await handleBlockedStoreMessage({ type: "foreign" })).toBeNull();
    expect(
      await handleBlockedStoreMessage({ type: "xblocker:record-blocked-action", input: null }),
    ).toBeNull();
    expect(await handleBlockedStoreMessage(message)).toEqual({ ok: true });
    expect(await blockedStore.get("@spammer")).toMatchObject({ blockCount: 1 });
  });

  test("BB-06 background storage failures become explicit responses", async () => {
    storageFake.failNextSet = true;
    expect(await handleBlockedStoreMessage(message)).toEqual({
      ok: false,
      error: "storage write failed",
    });
  });

  test("BB-07 listener rejects foreign messages synchronously and answers owned messages", async () => {
    type Listener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | undefined;
    let listener: Listener | undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test replaces Chrome's listener registrar with a capture-only fake.
    const onMessage = chrome.runtime.onMessage as unknown as {
      addListener: (value: unknown) => void;
    };
    const original = onMessage.addListener;
    onMessage.addListener = (value) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- installBlockedStoreMessageHandler supplies exactly this listener contract.
      listener = value as Listener;
    };
    try {
      installBlockedStoreMessageHandler();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler deliberately ignores sender metadata.
      const sender = {} as chrome.runtime.MessageSender;
      expect(listener?.({ type: "foreign" }, sender, () => {})).toBe(false);

      let response: unknown;
      expect(
        listener?.(message, sender, (value: unknown) => {
          response = value;
        }),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(response).toEqual({ ok: true });
    } finally {
      onMessage.addListener = original;
    }
  });
});
