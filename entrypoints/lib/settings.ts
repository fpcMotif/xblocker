// The single home for XBlocker's behavior-settings vocabulary: the SETTINGS_KEY blob
// (its type + defaults + normalizer + reader), the max-replies bounds + clamp, and the X
// username normalizer. Every surface that touches settings — the popup, the options
// General/Whitelist panes, and the content executor (actions.ts) — imports from here
// instead of keeping its own copy that can silently drift, e.g. raising the popup's cap
// while the content executor keeps the old one, or two normalizers diverging on garbage.

import { SETTINGS_KEY, storageGet } from "./chrome-storage";

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

/**
 * The persisted behavior-settings blob (stored under SETTINGS_KEY). The popup and the
 * options General pane each render a subset of these fields, and the content executor +
 * Whitelist pane read them — one type keeps every surface honest about the exact stored
 * shape, so a popup save can never drop a field another reader depends on.
 */
export type Settings = {
  protectWhitelist: boolean;
  confirmDestructiveActions: boolean;
  keyboardMode: boolean;
  maxReplies: number;
};

export const DEFAULT_SETTINGS: Settings = {
  protectWhitelist: true,
  confirmDestructiveActions: true,
  keyboardMode: false,
  maxReplies: DEFAULT_MAX_REPLIES,
};

// Cast-free narrowing for the stored blob — a type predicate, not an `as` assertion,
// so the lint gate's no-unsafe-type-assertion rule holds even here.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type BooleanSettingsKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

/** Normalize a raw stored value into a well-formed Settings blob field by field: a
 *  partial blob, or outright garbage (a string, null, an unrelated object), normalizes
 *  identically for every surface. Each of the 4 known fields is validated on its own —
 *  a wrong-typed field falls back to its default rather than poisoning the whole blob —
 *  and the result is built solely from those fields, so unknown keys (e.g. a stray
 *  `evil` a hand-edited or stale blob might carry) are stripped rather than persisted
 *  back on the next save. */
export function normalizeSettings(raw: unknown): Settings {
  const partial: Record<string, unknown> = isRecord(raw) ? raw : {};

  const boolField = (key: BooleanSettingsKey): boolean => {
    const value = partial[key];
    return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
  };

  return {
    protectWhitelist: boolField("protectWhitelist"),
    confirmDestructiveActions: boolField("confirmDestructiveActions"),
    keyboardMode: boolField("keyboardMode"),
    maxReplies: clampMaxReplies(partial["maxReplies"]),
  };
}

/** Read + normalize the settings blob in one call — the storageGet(SETTINGS_KEY) +
 *  normalize dance the popup and panes used to each hand-roll. */
export async function readSettings(): Promise<Settings> {
  return normalizeSettings(await storageGet<unknown>(SETTINGS_KEY));
}
