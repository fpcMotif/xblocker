import type { Page } from "@playwright/test";

import { SEED_NAMES, SEEDS } from "./data.ts";
import { axeViolations, expect, geometry, settle, test } from "./fixtures.ts";
import { HOST_FONT_SIZES } from "./x-fixture.ts";

const SCHEMES = ["light", "dark"] as const;
const OPTION_ROUTES = ["general", "whitelist", "blocked-log", "cloud", "about"] as const;
const HOST_THEME_NAMES = ["default", "dim", "lights-out"] as const;

async function expectClean(page: Page, root: string): Promise<void> {
  expect(await axeViolations(page, root)).toEqual([]);
  expect(await geometry(page, root)).toEqual({ overflowing: [], clipped: [], smallTargets: [] });
}

async function openRail(page: Page): Promise<void> {
  await page.locator(".xb-puck").click();
  await expect(page.locator(".xb-rail")).not.toHaveAttribute("data-state", "collapsed");
  await settle(page);
}

async function openModal(page: Page): Promise<void> {
  await openRail(page);
  await page.locator('.xb-rail [data-action="whitelist"]').click();
  await expect(page.locator(".xb-modal-backdrop")).toHaveAttribute("data-state", "open");
}

for (const scheme of SCHEMES) {
  for (const seedName of SEED_NAMES) {
    test(`popup ${scheme} ${seedName}`, async ({ seed, openExtensionPage }) => {
      await seed(SEEDS[seedName]);
      const page = await openExtensionPage("popup.html", { width: 360, height: 600, scheme });
      await page.getByText("Open settings").waitFor();
      if (seedName === "worst") {
        // Backup is on and the network is cut, so the row must land on its failed state.
        await page.getByText("Sync failed. Try again.").waitFor();
      }
      await settle(page);
      await expectClean(page, "body");
      await expect(page).toHaveScreenshot(`popup-${scheme}-${seedName}.png`, { fullPage: true });
    });
  }

  for (const route of OPTION_ROUTES) {
    test(`options ${scheme} ${route}`, async ({ seed, openExtensionPage }) => {
      await seed(SEEDS.worst);
      const page = await openExtensionPage(`options.html#${route}`, {
        width: 1280,
        height: 800,
        scheme,
      });
      await expectClean(page, "body");
      // Relative-time columns move with the clock, so the log is checked by rule, not pixel.
      if (route !== "blocked-log") {
        await expect(page).toHaveScreenshot(`options-${scheme}-${route}.png`);
      }
    });
  }
}

test("options at a narrow window keep every pane inside the viewport", async ({
  seed,
  openExtensionPage,
}) => {
  await seed(SEEDS.worst);
  for (const route of OPTION_ROUTES) {
    const page = await openExtensionPage(`options.html#${route}`, {
      width: 760,
      height: 700,
      scheme: "light",
    });
    expect((await geometry(page, "body")).overflowing, route).toEqual([]);
    await page.close();
  }
});

for (const theme of HOST_THEME_NAMES) {
  test(`content on x.com ${theme}`, async ({ openStatusPage }) => {
    const page = await openStatusPage({ theme });
    await expect(page.locator(".xb-rail")).toHaveScreenshot(`puck-${theme}.png`);

    await openRail(page);
    await expectClean(page, ".xb-rail");
    await expect(page.locator(".xb-rail-body")).toHaveScreenshot(`rail-${theme}.png`);

    await page.locator('.xb-rail [data-action="whitelist"]').click();
    await expect(page.locator(".xb-modal-backdrop")).toHaveAttribute("data-state", "open");
    await page.locator(".xb-modal-confirm").click();
    await expect(page.locator("#xb-username-error")).toBeVisible();
    await expectClean(page, ".xb-modal-backdrop");
    await expect(page.locator(".xb-modal")).toHaveScreenshot(`modal-error-${theme}.png`);

    await page.locator("#xb-username-input").fill("WWWWWWWWWWWWWWW");
    await page.locator(".xb-modal-confirm").click();
    const toast = page.locator(".xb-toast").first();
    await expect(toast).toHaveAttribute("data-state", "open");
    await settle(page);
    await expectClean(page, ".xb-toast-region");
    await expect(toast).toHaveScreenshot(`toast-${theme}.png`);
  });
}

test("x.com font-size steps do not change the injected UI", async ({ openStatusPage }) => {
  const measure = async (fontSize: number) => {
    const page = await openStatusPage({ theme: "lights-out", fontSize });
    await openModal(page);
    await settle(page);
    const boxes = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(".xb-rail-body, .xb-rail-body *, .xb-modal, .xb-modal *"),
      )
        .filter((element) => !(element instanceof SVGElement) || element.tagName === "svg")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return `${element.tagName}.${String(element.getAttribute("class"))} ${rect.width.toFixed(1)}x${rect.height.toFixed(1)} ${style.fontSize}/${style.lineHeight} ${style.fontFamily.slice(0, 12)}`;
        }),
    );
    await page.close();
    return boxes;
  };
  const baseline = await measure(15);
  for (const fontSize of HOST_FONT_SIZES) {
    expect(await measure(fontSize), `html font-size ${fontSize}px`).toEqual(baseline);
  }
});

test("motion stays short and off the layout path", async ({ openStatusPage }) => {
  const page = await openStatusPage({ theme: "default" });
  const collect = () =>
    page.evaluate(() =>
      document.getAnimations().flatMap((animation) => {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect) || !effect.target?.closest(".xb-root")) {
          return [];
        }
        const timing = effect.getComputedTiming();
        const property =
          animation instanceof CSSTransition
            ? animation.transitionProperty
            : Object.keys(effect.getKeyframes()[0] ?? {}).join(",");
        return timing.iterations === Infinity
          ? []
          : [{ property, ms: Number(timing.duration) + (timing.delay ?? 0) }];
      }),
    );
  const allowed =
    /^(opacity|transform|filter|display|background-color|color|border-(top|right|bottom|left)-color|box-shadow|offset|easing|composite|computedOffset|,)+$/;

  await page.locator(".xb-puck").click();
  const railMotion = await collect();
  await expect(page.locator(".xb-rail")).not.toHaveAttribute("data-state", "collapsed");
  await page.locator('.xb-rail [data-action="whitelist"]').click();
  const modalMotion = await collect();

  const all = [...railMotion, ...modalMotion];
  expect(all.length).toBeGreaterThan(0);
  expect(all.filter((entry) => entry.ms > 250)).toEqual([]);
  expect(all.filter((entry) => !allowed.test(entry.property))).toEqual([]);
});

test("the rail and modal work from the keyboard alone", async ({ openStatusPage }) => {
  const page = await openStatusPage({ theme: "dim" });
  const focused = () =>
    page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id ?? "",
    );

  await page.locator(".xb-puck").focus();
  expect(await focused()).not.toBe("");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xb-rail")).not.toHaveAttribute("data-state", "collapsed");

  const stops: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Tab");
    stops.push(await focused());
  }
  expect(stops).toEqual(
    expect.arrayContaining([
      "Block all replies",
      "Mute all replies",
      "Whitelist",
      "Open XBlocker settings",
    ]),
  );

  await page.locator('.xb-rail [data-action="whitelist"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".xb-modal-backdrop")).toHaveAttribute("data-state", "open");
  expect(await focused()).toBe("Username");

  // Focus must cycle inside the dialog while it is open.
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".xb-modal") !== null)).toBe(
      true,
    );
  }

  await page.keyboard.press("Escape");
  await expect(page.locator(".xb-modal-backdrop")).toHaveCount(0);
  expect(await focused()).toBe("Whitelist");
});
