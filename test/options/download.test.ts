// Catalog: OD-* (downloadJson + the default Blob/URL/anchor download seam).
import { beforeEach, describe, expect, test } from "bun:test";

import { downloadJson } from "../../entrypoints/options/download.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("downloadJson", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OD-01 pretty-prints the data as JSON and hands it to the injected download fn", async () => {
    let capturedFilename: string | undefined;
    let capturedBlob: Blob | undefined;
    downloadJson("thing.json", { a: 1, b: [2, 3] }, (filename, blob) => {
      capturedFilename = filename;
      capturedBlob = blob;
    });

    expect(capturedFilename).toBe("thing.json");
    expect(capturedBlob?.type).toContain("application/json");
    expect(await capturedBlob?.text()).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });

  test("OD-02 the default download fn creates and clicks a throwaway anchor without leaving it in the DOM", () => {
    expect(() => downloadJson("default-path.json", ["x"])).not.toThrow();
    expect(document.querySelectorAll("a").length).toBe(0);
  });
});
