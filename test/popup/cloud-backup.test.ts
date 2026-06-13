// Catalog: PU-CB-* (cloud backup toggle, sign-in / sync controls, runCloudSync).
//
// convex-sync talks to a live Convex deployment + Google OAuth (see its header) and is
// intentionally excluded from unit tests. We mock it at the popup boundary so the
// popup's sync wiring is exercised without pulling in the real adapter.
import { beforeEach, describe, expect, mock, test } from "bun:test";

let configured: boolean;
let ensureAuthResult: boolean;
let signInResult: { email: string };
let currentEmailValue: string | undefined;
let pushOutboxImpl: (items: unknown[]) => Promise<string[]>;
let pullBlockedImpl: () => Promise<unknown[]>;
let calls: { push: number; pull: number };

await mock.module("../../entrypoints/lib/convex-sync", () => ({
  isCloudConfigured: () => configured,
  signIn: async () => signInResult,
  ensureAuth: async () => ensureAuthResult,
  currentEmail: () => currentEmailValue,
  pushOutbox: async (items: unknown[]) => {
    calls.push += 1;
    return pushOutboxImpl(items);
  },
  pullBlocked: async () => {
    calls.pull += 1;
    return pullBlockedImpl();
  },
}));

const { renderPopup } = await import("../../entrypoints/popup/main.ts");
const { resetTestEnvironment, storageFake } = await import("../setup.ts");

/** The "Cloud backup" <section>, located by its heading. */
function cloudSection(): HTMLElement {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".xb-popup-section"));
  const section = sections.find((node) => node.querySelector("h2")?.textContent === "Cloud backup");
  if (!section) throw new Error("Cloud backup section was not rendered");
  return section;
}

/** Drain microtasks queued by the fire-and-forget sync handlers. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("popup cloud backup", () => {
  beforeEach(() => {
    resetTestEnvironment();
    configured = true;
    ensureAuthResult = true;
    signInResult = { email: "me@example.com" };
    currentEmailValue = "me@example.com";
    pushOutboxImpl = async (items) =>
      (items as Array<{ action: { actionId: string } }>).map((item) => item.action.actionId);
    pullBlockedImpl = async () => [];
    calls = { push: 0, pull: 0 };
  });

  test("PU-CB-01 enabling backup signs in non-interactively and drains the outbox", async () => {
    storageFake.data["blockedOutbox"] = [
      {
        accountKey: "1",
        xUserId: "1",
        handle: "spammer",
        idUnknown: false,
        action: { actionId: "a1", kind: "block", at: 1, source: "reply-bar" },
      },
    ];
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-switch-input")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(calls.push).toBe(1);
    expect(calls.pull).toBe(1);
    expect(storageFake.data["blockedOutbox"]).toEqual([]);
    expect(cloudSection().textContent).toContain("Backed up");
    expect((storageFake.data["settings"] as { cloudBackup: boolean }).cloudBackup).toBe(true);
  });

  test("PU-CB-02 disabling backup reports off and runs no sync", async () => {
    storageFake.data["settings"] = { cloudBackup: true };
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-switch-input")!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(calls.push).toBe(0);
    expect(calls.pull).toBe(0);
    expect(cloudSection().textContent).toContain("device only");
  });

  test("PU-CB-03 the Sign in button runs the interactive flow", async () => {
    await renderPopup(document.body);

    const signIn = cloudSection().querySelector<HTMLButtonElement>(".xb-button")!;
    signIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(calls.pull).toBe(1);
    expect(cloudSection().textContent).toContain("Backed up");
  });

  test("PU-CB-04 reports when cloud backup is not configured", async () => {
    configured = false;
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-switch-input")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Not configured");
    expect(calls.pull).toBe(0);
  });

  test("PU-CB-05 prompts to sign in when non-interactive auth fails", async () => {
    ensureAuthResult = false;
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-switch-input")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Sign in to enable backup");
    expect(calls.pull).toBe(0);
  });

  test("PU-CB-06 surfaces a sync error raised from the toggle", async () => {
    pullBlockedImpl = async () => {
      throw new Error("network boom");
    };
    await renderPopup(document.body);

    const toggle = cloudSection().querySelector<HTMLInputElement>(".xb-switch-input")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Backup error: network boom");
  });

  test("PU-CB-07 surfaces a sync error raised from the Sign in button", async () => {
    pullBlockedImpl = async () => {
      throw new Error("button boom");
    };
    await renderPopup(document.body);

    const signIn = cloudSection().querySelector<HTMLButtonElement>(".xb-button")!;
    signIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    expect(cloudSection().textContent).toContain("Backup error: button boom");
  });
});
