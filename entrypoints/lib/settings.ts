// Settings primitives shared by the content script and the popup
// (popup/main.ts): the max-replies bounds + clamp, and the X username normalizer.
// Both bundles import this one definition instead of keeping copies that can drift —
// e.g. raising the popup's cap while the content executor silently keeps the old one.

export const DEFAULT_MAX_REPLIES = 50;
export const MAX_REPLIES_LIMIT = 200;

// X reserves these first path segments for routes, so they are never valid handles.
const RESERVED_X_PATHS = new Set<string>([
  "explore",
  "home",
  "i",
  "intent",
  "messages",
  "notifications",
  "search",
  "settings",
  "share",
]);

/** Normalize a raw "@handle" / "handle" into a valid X screen name, or null when invalid. */
export function normalizeUsername(value: string | null | undefined): string | null {
  const username = value?.replace(/^@/, "").trim();
  if (!username || RESERVED_X_PATHS.has(username.toLowerCase())) {
    return null;
  }

  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : null;
}

/** Clamp an arbitrary maxReplies value into [1, MAX_REPLIES_LIMIT], defaulting on
 *  non-finite/non-numeric input. Numeric strings are parsed; fractions are truncated. */
export function clampMaxReplies(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_REPLIES;
  }

  return Math.min(MAX_REPLIES_LIMIT, Math.max(1, parsed));
}
