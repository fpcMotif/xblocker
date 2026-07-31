import { describe, expect, test } from "bun:test";

import { parseRgb } from "../../entrypoints/content/theme.ts";

describe("parseRgb", () => {
  test("PRGB-01 valid rgb strings with varying spacing", () => {
    expect(parseRgb("rgb(255, 0, 128)")).toEqual([255, 0, 128]);
    expect(parseRgb("rgb(0,0,0)")).toEqual([0, 0, 0]);
    expect(parseRgb("rgb( 10 ,  20 , 30 )")).toEqual([10, 20, 30]);
    expect(parseRgb("rgb(255, 255, 255)")).toEqual([255, 255, 255]);
  });

  test("PRGB-02 valid rgba strings with varying spacing and alpha values", () => {
    expect(parseRgb("rgba(255, 0, 128, 1)")).toEqual([255, 0, 128]);
    expect(parseRgb("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0]);
    expect(parseRgb("rgba( 10 ,  20 , 30 ,  0.9 )")).toEqual([10, 20, 30]);
    expect(parseRgb("rgba(255, 255, 255, .8)")).toEqual([255, 255, 255]);
  });

  test("PRGB-03 fully transparent colors return null", () => {
    expect(parseRgb("rgba(255, 0, 128, 0)")).toBeNull();
    expect(parseRgb("rgba(0, 0, 0, 0.0)")).toBeNull();
    expect(parseRgb("rgba(255, 255, 255, 0)")).toBeNull();
  });

  test("PRGB-04 invalid color strings return null", () => {
    expect(parseRgb("#ffffff")).toBeNull();
    expect(parseRgb("#000")).toBeNull();
    expect(parseRgb("red")).toBeNull();
    expect(parseRgb("transparent")).toBeNull();
    expect(parseRgb("hsl(0, 100%, 50%)")).toBeNull();
    expect(parseRgb("hsla(0, 100%, 50%, 1)")).toBeNull();
    expect(parseRgb("rgb(255, 0)")).toBeNull(); // missing channel
    expect(parseRgb("rgb(255, 0, 128, 1, 0)")).toBeNull(); // too many channels
    expect(parseRgb("")).toBeNull(); // empty string
    expect(parseRgb("invalid rgb(0,0,0) string")).toBeNull(); // string not starting with rgb
  });

  test("PRGB-05 handling of mixed case or invalid format", () => {
    // getComputedStyle returns lowercase rgb() or rgba(), but let's test our tolerance
    expect(parseRgb("RGB(255, 0, 0)")).toEqual([255, 0, 0]);
    expect(parseRgb("rgb(255, 0, 0")).toBeNull(); // missing closing paren
    expect(parseRgb("rgba(255, 0, 0, 1")).toBeNull(); // missing closing paren
    expect(parseRgb("invalid rgb(255,0,0)")).toBeNull();
    expect(parseRgb("rgb(255,0,0) extra")).toBeNull();
  });
});
