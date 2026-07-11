// Catalog: DT-* (design-tokens canonical source + styles.ts interpolation).
import { describe, expect, test } from "bun:test";

import {
  XB_DARK_TOKENS,
  XB_FONT_STACK,
  XB_LIGHT_TOKENS,
  XB_TONE_TOKENS,
} from "../entrypoints/lib/design-tokens.ts";

/** Every `--xb-*` custom property name declared in a token block, in declaration order. */
function tokenNames(block: string): string[] {
  return Array.from(block.matchAll(/--xb-[a-z-]+(?=:)/g), (match) => match[0]);
}

describe("XB_DARK_TOKENS / XB_LIGHT_TOKENS", () => {
  test("DT-01 declare the same set of --xb-* custom properties", () => {
    const darkNames = tokenNames(XB_DARK_TOKENS);
    const lightNames = tokenNames(XB_LIGHT_TOKENS);

    expect(darkNames.length).toBeGreaterThan(0);
    expect(new Set(darkNames)).toEqual(new Set(lightNames));
  });
});

describe("XB_TONE_TOKENS", () => {
  test("DT-02 declares the primary/danger/success/warning tones as OKLCH colors", () => {
    expect(XB_TONE_TOKENS).toContain("oklch(");
    expect(XB_TONE_TOKENS).toContain("--xb-primary");
    expect(XB_TONE_TOKENS).toContain("--xb-danger");
    expect(XB_TONE_TOKENS).toContain("--xb-success");
    expect(XB_TONE_TOKENS).toContain("--xb-warning");
  });
});

describe("XB_FONT_STACK", () => {
  test("DT-03 leads with Inter", () => {
    expect(XB_FONT_STACK.startsWith('"Inter"')).toBe(true);
  });
});

describe("content/styles.ts's injected sheet", () => {
  test("DT-04 still contains the tokens after interpolating design-tokens.ts's exports", async () => {
    const { ensureStyles } = await import("../entrypoints/content/styles.ts");
    ensureStyles();

    const style = document.getElementById("xblocker-styles");
    expect(style?.textContent).toContain("oklch(");
    expect(style?.textContent).toContain(".xb-root");
    expect(style?.textContent).toContain("--xb-primary");
    expect(style?.textContent).toContain(XB_FONT_STACK);
  });
});
