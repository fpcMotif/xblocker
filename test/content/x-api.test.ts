import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { hooks, installFetchStub } from "../helpers/content-hooks.ts";
import { resetTestEnvironment, setDocumentCookie } from "../setup.ts";

describe("performDirectAction", () => {
  let fetchStub: ReturnType<typeof installFetchStub> | null = null;

  beforeEach(() => {
    resetTestEnvironment();
    setDocumentCookie("ct0=csrf-token; auth_token=session-token");
  });

  afterEach(() => {
    fetchStub?.uninstall();
    fetchStub = null;
  });

  test("throws an error with the HTTP status when response.ok is false (block)", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 500 }));

    expect(hooks.performDirectAction("block", "test_user")).rejects.toThrow(
      "Direct block failed with HTTP 500.",
    );
  });

  test("throws an error with the HTTP status when response.ok is false (mute)", async () => {
    fetchStub = installFetchStub(() => ({ ok: false, status: 403 }));

    expect(hooks.performDirectAction("mute", "test_user")).rejects.toThrow(
      "Direct mute failed with HTTP 403.",
    );
  });
});
