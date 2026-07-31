// Direct X API layer: builds and sends the block/mute POST requests that let the
// reply batch (actions.ts) and the Cursor Console (quick-block.ts) act on an account
// without ever opening X's own •••-menu confirmation flow. Split out of actions.ts —
// moved verbatim so the cookie/bearer/ct0 request plumbing and response parsing stay a
// separate concern from batch orchestration and DOM author extraction.
import { normalizeUsername } from "../../packages/storage/settings";

export type DirectActionType = "block" | "mute";

export type DirectActionRequest = {
  url: string;
  options: RequestInit & {
    method: "POST";
    credentials: "include";
    headers: Record<string, string>;
    body: string;
  };
};

const X_AUTH_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const DIRECT_ACTION_ENDPOINTS: Record<DirectActionType, string> = {
  block: "/1.1/blocks/create.json",
  mute: "/1.1/mutes/users/create.json",
};

export function getCookieValue(name: string): string {
  return (
    document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}

function getXApiBaseUrl(): string {
  return window.location.hostname === "twitter.com"
    ? "https://api.twitter.com"
    : "https://api.x.com";
}

function createDirectActionRequest(type: DirectActionType, username: string): DirectActionRequest {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error(`Missing valid username for direct ${type}.`);
  }

  const csrfToken = getCookieValue("ct0");
  if (!csrfToken) {
    throw new Error("Missing X CSRF token; open x.com while signed in and try again.");
  }

  return {
    url: `${getXApiBaseUrl()}${DIRECT_ACTION_ENDPOINTS[type]}`,
    options: {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${X_AUTH_BEARER_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Csrf-Token": csrfToken,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
      },
      body: new URLSearchParams({ screen_name: normalizedUsername }).toString(),
    },
  };
}

export function createDirectBlockRequest(username: string): DirectActionRequest {
  return createDirectActionRequest("block", username);
}

export function createDirectMuteRequest(username: string): DirectActionRequest {
  return createDirectActionRequest("mute", username);
}

// Exported (not module-private) so the reply-batch orchestration in actions.ts can drive
// a single direct call per reply; re-exported to callers via `export * from "./x-api"`.
export async function performDirectAction(
  type: DirectActionType,
  username: string,
): Promise<Response> {
  const request = createDirectActionRequest(type, username);
  const response = await fetch(request.url, request.options);
  if (!response.ok) {
    throw new Error(`Direct ${type} failed with HTTP ${response.status}.`);
  }
  return response;
}

export type DirectBlockOutcome = { screen_name: string; id_str?: string };

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readProp(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}

// blocks/create.json returns the blocked user object, including the stable numeric
// id_str. Capture it so the local store keys on the id rather than the mutable screen
// name. Fall back to the screen name if the body is missing or unreadable. Exported for
// actions.ts's recordAction, which persists this outcome to the local store.
export async function readBlockOutcome(
  response: Response,
  username: string,
): Promise<DirectBlockOutcome> {
  let screenName = normalizeUsername(username) ?? username;
  let idStr: string | undefined;
  try {
    const body = safeParseJson(await response.text());
    const idStrValue = readProp(body, "id_str");
    const idValue = readProp(body, "id");
    const screenNameValue = readProp(body, "screen_name");
    if (typeof idStrValue === "string") {
      idStr = idStrValue;
    } else if (typeof idValue === "number") {
      idStr = String(idValue);
    }
    if (typeof screenNameValue === "string") {
      screenName = screenNameValue;
    }
  } catch (error) {
    console.warn("Could not read block response body; falling back to screen name.", error);
  }

  return { screen_name: screenName, ...(idStr ? { id_str: idStr } : {}) };
}

export function blockUserDirectly(username: string): Promise<Response> {
  return performDirectAction("block", username);
}

export function muteUserDirectly(username: string): Promise<Response> {
  return performDirectAction("mute", username);
}
