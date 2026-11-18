import path from "node:path";
import { fileURLToPath } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";

import { FIXTURE_URL, statusPageHtml, type HostTheme } from "./x-fixture.ts";

const EXTENSION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.output/chrome-mv3",
);

type StorageSeed = Record<string, unknown>;

type DesignFixtures = {
  context: BrowserContext;
  extensionId: string;
  /** Replace the extension's chrome.storage.local contents. */
  seed: (items: StorageSeed) => Promise<void>;
  /** Open an extension page (popup.html, options.html#route) at a viewport and scheme. */
  openExtensionPage: (
    file: string,
    options: { width: number; height: number; scheme: "light" | "dark" },
  ) => Promise<Page>;
  /** Open the x.com status fixture with the content script injected. */
  openStatusPage: (options: { theme: HostTheme; fontSize?: number }) => Promise<Page>;
};

export const test = base.extend<DesignFixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      deviceScaleFactor: 2,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    // Nothing in the suite may reach the network: x.com is the fixture, the rest is dropped.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("chrome-extension://")) {
        return route.continue();
      }
      return route.abort();
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(new URL(worker.url()).host);
  },

  seed: async ({ context, extensionId }, use) => {
    await use(async (items) => {
      const worker = context
        .serviceWorkers()
        .find((candidate) => candidate.url().includes(extensionId));
      if (!worker) {
        throw new Error("Extension service worker is not running");
      }
      await worker.evaluate(async (data) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(data);
      }, items);
    });
  },

  openExtensionPage: async ({ context, extensionId }, use) => {
    await use(async (file, options) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: options.scheme });
      await page.setViewportSize({ width: options.width, height: options.height });
      await page.goto(`chrome-extension://${extensionId}/${file}`);
      await settle(page);
      return page;
    });
  },

  openStatusPage: async ({ context, extensionId: _extensionId }, use) => {
    await use(async (options) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.route("https://x.com/**", (route) =>
        route.fulfill({ contentType: "text/html", body: statusPageHtml(options) }),
      );
      await page.goto(FIXTURE_URL);
      await page.locator("#xblocker-reply-rail").waitFor({ state: "attached" });
      await settle(page);
      return page;
    });
  },
});

export { expect } from "@playwright/test";

/** Wait for fonts, two frames, and every finite animation, so measurements see the resting UI. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
}

/** Axe violations for the page (or one subtree), as short readable lines. */
export async function axeViolations(page: Page, include?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]);
  const results = await (include ? builder.include(include) : builder).analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id}: ${node.target.join(" ")} — ${node.failureSummary?.split("\n")[1]?.trim() ?? ""}`,
    ),
  );
}

export type GeometryReport = { overflowing: string[]; clipped: string[]; smallTargets: string[] };

/**
 * Layout defects a screenshot would show but a DOM test cannot: elements wider than
 * their box, text cut off without an ellipsis, and pointer targets under 24x24.
 */
export async function geometry(page: Page, rootSelector: string): Promise<GeometryReport> {
  return page.evaluate((selector) => {
    const describe = (element: Element): string => {
      const id = element.id ? `#${element.id}` : "";
      const cls =
        typeof element.className === "string" && element.className
          ? `.${element.className.split(" ")[0]}`
          : "";
      const text = (element.textContent ?? "").trim().slice(0, 24);
      return `${element.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
    };
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.opacity !== "0"
      );
    };
    const report: GeometryReport = { overflowing: [], clipped: [], smallTargets: [] };
    const roots = Array.from(document.querySelectorAll(selector));
    const viewportWidth = document.documentElement.clientWidth;
    for (const root of roots) {
      for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          continue;
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (rect.right > viewportWidth + 0.5 || rect.left < -0.5) {
          report.overflowing.push(`${describe(element)} leaves the viewport`);
        }
        const hidesOverflow = style.overflowX !== "visible";
        // A child pulled out by a negative margin is a deliberate bleed (row hover insets).
        const bleed = Math.max(
          0,
          ...Array.from(
            element.querySelectorAll("*"),
            (child) => -Number.parseFloat(getComputedStyle(child).marginRight),
          ),
        );
        if (element.scrollWidth > element.clientWidth + 4 + bleed && element.clientWidth > 0) {
          if (!hidesOverflow) {
            report.overflowing.push(
              `${describe(element)} content ${element.scrollWidth}px in ${element.clientWidth}px`,
            );
          } else if (
            style.textOverflow !== "ellipsis" &&
            style.overflowX === "hidden" &&
            element.children.length === 0
          ) {
            report.clipped.push(`${describe(element)} clips text without an ellipsis`);
          }
        }
        const interactive = element.matches(
          "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])",
        );
        if (interactive && !element.matches(":disabled")) {
          // A ::after hit-area extension counts toward the target, as it does for a pointer.
          const after = getComputedStyle(element, "::after");
          const grow =
            after.content !== "none" && after.position === "absolute"
              ? -Number.parseFloat(after.top || "0")
              : 0;
          const extra = Number.isFinite(grow) && grow > 0 ? grow * 2 : 0;
          if (rect.width + extra < 24 || rect.height + extra < 24) {
            report.smallTargets.push(
              `${describe(element)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
            );
          }
        }
      }
    }
    return report;
  }, rootSelector);
}
