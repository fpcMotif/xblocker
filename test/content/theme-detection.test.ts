// Catalog: TD-* (theme detection). Pins the precedence that keeps the rail's
// surface matching X: an explicit color-scheme wins, then the body's actual
// luminance, and only an indeterminate surface falls back to weak hints. The
// regression guard is TD-05: a clearly light page must NOT be flipped dark by a
// stray meta theme-color (the observed dark-on-light misfire).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { detectTheme } from "../../entrypoints/content/theme.ts";
import { resetTestEnvironment } from "../setup.ts";

function setColorScheme(scheme: string): void {
  document.documentElement.style.colorScheme = scheme;
}

function setBodyBackground(color: string): void {
  document.body.style.backgroundColor = color;
}

function addThemeColorMeta(content: string): void {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", content);
  document.head.appendChild(meta);
}

describe("detectTheme precedence", () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  afterEach(() => {
    resetTestEnvironment();
  });

  test("TD-01 an explicit color-scheme of dark resolves to dark", () => {
    setColorScheme("dark");
    expect(detectTheme()).toBe("dark");
  });

  test("TD-02 an explicit color-scheme of light wins even over a dark body surface", () => {
    setColorScheme("light");
    setBodyBackground("rgb(0, 0, 0)");
    expect(detectTheme()).toBe("light");
  });

  test("TD-03 a dark body surface (lights-out / dim) resolves to dark", () => {
    setColorScheme("");
    setBodyBackground("rgb(0, 0, 0)");
    expect(detectTheme()).toBe("dark");

    setBodyBackground("rgb(21, 32, 43)"); // X "dim"
    expect(detectTheme()).toBe("dark");
  });

  test("TD-04 a light body surface resolves to light", () => {
    setColorScheme("");
    setBodyBackground("rgb(255, 255, 255)");
    expect(detectTheme()).toBe("light");
  });

  test("TD-05 a clearly light page is NOT flipped dark by a stray theme-color meta", () => {
    setColorScheme("");
    setBodyBackground("rgb(255, 255, 255)");
    addThemeColorMeta("#000000");
    expect(detectTheme()).toBe("light");
  });

  test("TD-06 an indeterminate surface falls back to the theme-color meta hint", () => {
    setColorScheme("");
    setBodyBackground(""); // computed background is empty -> indeterminate
    addThemeColorMeta("#000000");
    expect(detectTheme()).toBe("dark");
  });

  test("TD-07 a fully transparent surface with a data-theme=dark hint resolves to dark", () => {
    setColorScheme("");
    setBodyBackground("rgba(0, 0, 0, 0)"); // transparent -> no usable surface color
    document.documentElement.setAttribute("data-theme", "dark");
    expect(detectTheme()).toBe("dark");
  });

  test("TD-08 an indeterminate surface with no hints defaults to light", () => {
    setColorScheme("");
    setBodyBackground("");
    expect(detectTheme()).toBe("light");
  });
});
