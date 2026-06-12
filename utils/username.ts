/**
 * The single definition of a valid X handle. Every surface — block, mute,
 * popup form, page modal — parses and compares usernames through this module,
 * so the whitelist always protects exactly whoever the user named.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

const RESERVED_X_PATHS = new Set<string>([
  "home",
  "i",
  "intent",
  "messages",
  "notifications",
  "search",
  "settings",
  "share",
]);

/**
 * Parse raw user input or a URL path segment into a canonical handle.
 * Strips a leading `@`, rejects reserved X paths, and validates the
 * handle shape. Returns the display form, or null if invalid.
 */
export function parseUsername(value: string | null | undefined): string | null {
  const username = value?.replace(/^@/, "").trim();
  if (!username || RESERVED_X_PATHS.has(username.toLowerCase())) {
    return null;
  }

  return USERNAME_PATTERN.test(username) ? username : null;
}

/** X handles are case-insensitive; display form is preserved everywhere else. */
export function sameUsername(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Extract the author handle from a tweet article's profile links. */
export function usernameFromTweet(tweetArticle: Element): string | null {
  const links = tweetArticle.querySelectorAll('a[href^="/"][role="link"]');
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const firstPathPart = href.split("?")[0]?.split("/").find(Boolean) || "";
    const username = parseUsername(firstPathPart);
    if (username) {
      return username;
    }
  }

  return null;
}
