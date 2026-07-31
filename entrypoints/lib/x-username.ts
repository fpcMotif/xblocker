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

/** Normalize a raw "@handle" / "handle" into a valid X screen name, or null. */
export function normalizeUsername(value: string | null | undefined): string | null {
  const username = value?.replace(/^@/, "").trim();
  if (!username || RESERVED_X_PATHS.has(username.toLowerCase())) return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : null;
}
