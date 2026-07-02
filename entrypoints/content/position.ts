export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const VIEWPORT_MARGIN = 8;
export const FOLLOW_FACTOR = 0.22;
export const JITTER_PX = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function lerp(from: number, to: number, factor: number): number {
  return from + (to - from) * factor;
}

export function computeRailY(cursorY: number, railHeight: number, viewport: Size): number {
  return clamp(
    cursorY - railHeight / 2,
    VIEWPORT_MARGIN,
    viewport.height - railHeight - VIEWPORT_MARGIN,
  );
}

export function exceedsJitter(a: Point, b: Point, threshold = JITTER_PX): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) > threshold;
}
