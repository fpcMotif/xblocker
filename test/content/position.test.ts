// Catalog: RAIL-* (computeRailY), JIT-* (exceedsJitter), LERP-* (lerp),
// CONST-* (exported constants).
//
// position.ts is pure math, so these tests import it directly instead of going
// through the content-script hooks.
import { describe, expect, test } from "bun:test";

import {
  FOLLOW_FACTOR,
  JITTER_PX,
  VIEWPORT_MARGIN,
  computeRailY,
  exceedsJitter,
  lerp,
} from "../../entrypoints/content/position.ts";

const VIEWPORT = { width: 1280, height: 720 };
const RAIL_HEIGHT = 280;

describe("computeRailY", () => {
  test("RAIL-01 centers the rail on the cursor in a roomy viewport", () => {
    // 360 - 280 / 2 = 220.
    expect(computeRailY(360, RAIL_HEIGHT, VIEWPORT)).toBe(220);
  });

  test("RAIL-02 clamps to the 8px top margin when the cursor is near the top", () => {
    // 0 - 140 = -140 < VIEWPORT_MARGIN, so the rail pins at 8.
    expect(computeRailY(0, RAIL_HEIGHT, VIEWPORT)).toBe(8);
  });

  test("RAIL-03 clamps to the bottom margin when the cursor is near the bottom", () => {
    // 720 - 140 = 580 > max 720 - 280 - 8 = 432, so the rail pins at 432.
    expect(computeRailY(720, RAIL_HEIGHT, VIEWPORT)).toBe(720 - RAIL_HEIGHT - 8);
  });

  test("RAIL-04 exact-fit positions sit on the clamp edges without moving", () => {
    // Centered y === min margin: cursorY = 8 + 140 = 148.
    expect(computeRailY(148, RAIL_HEIGHT, VIEWPORT)).toBe(8);
    // Centered y === max: cursorY = 432 + 140 = 572.
    expect(computeRailY(572, RAIL_HEIGHT, VIEWPORT)).toBe(432);
  });

  test("RAIL-05 rail taller than the viewport returns the top margin for any cursor", () => {
    // max = 720 - 800 - 8 = -88 < min 8; the clamp resolves to the margin.
    expect(computeRailY(0, 800, VIEWPORT)).toBe(8);
    expect(computeRailY(360, 800, VIEWPORT)).toBe(8);
    expect(computeRailY(720, 800, VIEWPORT)).toBe(8);
  });
});

describe("exceedsJitter", () => {
  test("JIT-01 points 3px apart are within the default 4px threshold", () => {
    expect(exceedsJitter({ x: 100, y: 100 }, { x: 100, y: 103 })).toBe(false);
  });

  test("JIT-02 points 5px apart exceed the default threshold", () => {
    expect(exceedsJitter({ x: 100, y: 100 }, { x: 100, y: 105 })).toBe(true);
  });

  test("JIT-03 exactly 4px apart is NOT exceeding (boundary uses strict >)", () => {
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(false);
  });

  test("JIT-04 distance is Euclidean, not per-axis", () => {
    // (3, 3) is within 4px on each axis but sqrt(18) ≈ 4.24 > 4 overall.
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    // 3-4-5 triangle: diagonal distance is exactly 5 > 4.
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    // (2, 2) is sqrt(8) ≈ 2.83 < 4.
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });

  test("JIT-05 a custom threshold overrides the default", () => {
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 0, y: 8 }, 10)).toBe(false);
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 0, y: 10 }, 10)).toBe(false);
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 0, y: 12 }, 10)).toBe(true);
    // A tighter threshold flips a default-passing pair.
    expect(exceedsJitter({ x: 0, y: 0 }, { x: 0, y: 3 }, 2)).toBe(true);
  });
});

describe("lerp", () => {
  test("LERP-01 midpoint: factor 0.5 lands halfway", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });

  test("LERP-02 identity at the endpoints: factor 0 returns from, factor 1 returns to", () => {
    expect(lerp(3, 99, 0)).toBe(3);
    expect(lerp(3, 99, 1)).toBe(99);
  });

  test("LERP-03 Glide factor advances proportionally toward the target", () => {
    expect(lerp(0, 100, FOLLOW_FACTOR)).toBe(22);
    expect(lerp(100, 200, 0.22)).toBe(122);
  });
});

describe("exported constants", () => {
  test("CONST-01 margin, follow factor, and jitter threshold match the design values", () => {
    expect(VIEWPORT_MARGIN).toBe(8);
    expect(FOLLOW_FACTOR).toBe(0.22);
    expect(FOLLOW_FACTOR).toBeGreaterThan(0);
    expect(FOLLOW_FACTOR).toBeLessThan(1);
    expect(JITTER_PX).toBe(4);
  });
});
