// Catalog: OA-* (About pane: version line, tagline, repo link, privacy note).
import { beforeEach, describe, expect, test } from "bun:test";

import { renderAboutPane } from "../../entrypoints/options/panes/about.ts";
import { resetTestEnvironment } from "../setup.ts";

describe("About pane", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  test("OA-01 renders the mark, tagline, GitHub link, and privacy note", () => {
    renderAboutPane(document.body);

    expect(document.querySelector("h1")?.textContent).toBe("About");
    expect(document.querySelector(".xb-opt-about-mark svg")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Local-first reply-spam blocking for X, with optional private cloud backup.",
    );
    expect(document.body.textContent).toContain(
      "Data stays on this device unless cloud backup is turned on.",
    );

    const link = document.querySelector<HTMLAnchorElement>(".xb-opt-link-row");
    expect(link?.getAttribute("href")).toBe("https://github.com/daymade/Twitter-Block-Porn");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  test("OA-02 shows the real manifest version when chrome.runtime.getManifest is present", () => {
    (chrome.runtime as { getManifest?: () => { version: string } }).getManifest = () => ({
      version: "1.2.3",
    });
    try {
      renderAboutPane(document.body);
      expect(document.querySelector(".xb-opt-about-version")?.textContent).toBe("Version 1.2.3");
    } finally {
      delete (chrome.runtime as { getManifest?: () => { version: string } }).getManifest;
    }
  });

  test("OA-03 falls back to 'Version unknown' when getManifest is absent (test mock)", () => {
    renderAboutPane(document.body);
    expect(document.querySelector(".xb-opt-about-version")?.textContent).toBe("Version unknown");
  });

  test("OA-04 destroy() is a harmless no-op", () => {
    const handle = renderAboutPane(document.body);
    expect(() => handle.destroy()).not.toThrow();
  });
});
