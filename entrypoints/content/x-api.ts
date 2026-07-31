// Direct X API layer: builds and sends the block/mute POST requests that let the
// reply batch (actions.ts) and the Cursor Console (quick-block.ts) act on an account
// without ever opening X's own •••-menu confirmation flow. Split out of actions.ts —
// moved verbatim so the cookie/bearer/ct0 request plumbing and response parsing stay a
// separate concern from batch orchestration and DOM author extraction.
import { normalizeUsername } from "../lib/settings";

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
// friendships/show is the same v1.1 vintage as the create endpoints above (not
// deprecated, not moved to GraphQL) and reports the authenticated user's own
// relationship to a target, including `blocking`/`muting` -- exactly the confirmation
// ADR-0001-line work needs. See docs/adr/0004-bulk-confirm-and-retry.md.
const RELATIONSHIP_LOOKUP_ENDPOINT = "/1.1/friendships/show.json";

/** A direct-API HTTP failure, carrying the status so callers can classify a 429
 *  (rate-limited) failure differently from an ordinary one without parsing the
 *  message string. */
export class DirectApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DirectApiError";
    this.status = status;
  }
}

/** True for a rate-limit-shaped failure (HTTP 429) from either the action or the
 *  confirmation call -- the bulk runner backs its retry off meaningfully further
 *  for these than for an ordinary failure. */
export function isRateLimited(error: unknown): boolean {
  return error instanceof DirectApiError && error.status === 429;
}

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

/** A validated (normalized username, CSRF token) pair, or a thrown Error naming
 *  whichever check failed first -- shared by every request builder below so an
 *  action POST and the relationship-lookup GET fail identically on a bad username
 *  or a signed-out session. */
function requireSessionAuth(
  actionDescription: string,
  username: string,
): {
  normalizedUsername: string;
  csrfToken: string;
} {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error(`Missing valid username for ${actionDescription}.`);
  }

  const csrfToken = getCookieValue("ct0");
  if (!csrfToken) {
    throw new Error("Missing X CSRF token; open x.com while signed in and try again.");
  }

  return { normalizedUsername, csrfToken };
}

/** The bearer + ct0 + X-Twitter-* headers every direct-API request carries (ADR-0001);
 *  a POST additionally sets Content-Type, added by its own caller. */
function sessionAuthHeaders(csrfToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${X_AUTH_BEARER_TOKEN}`,
    "X-Csrf-Token": csrfToken,
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Auth-Type": "OAuth2Session",
  };
}

function createDirectActionRequest(type: DirectActionType, username: string): DirectActionRequest {
  const { normalizedUsername, csrfToken } = requireSessionAuth(`direct ${type}`, username);

  return {
    url: `${getXApiBaseUrl()}${DIRECT_ACTION_ENDPOINTS[type]}`,
    options: {
      method: "POST",
      credentials: "include",
      headers: {
        ...sessionAuthHeaders(csrfToken),
        "Content-Type": "application/x-www-form-urlencoded",
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

/** Throws a status-carrying DirectApiError when `response` isn't a 2xx; shared by
 *  every call site below so an action POST and the relationship-lookup GET raise the
 *  same shape of error (only the message prefix differs). */
function ensureOk(response: Response, failureDescription: string): void {
  if (!response.ok) {
    throw new DirectApiError(
      `${failureDescription} with HTTP ${response.status}.`,
      response.status,
    );
  }
}

// Exported (not module-private) so the reply-batch orchestration in actions.ts can drive
// a single direct call per reply; re-exported to callers via `export * from "./x-api"`.
export async function performDirectAction(
  type: DirectActionType,
  username: string,
): Promise<Response> {
  const request = createDirectActionRequest(type, username);
  const response = await fetch(request.url, request.options);
  ensureOk(response, `Direct ${type} failed`);
  return response;
}

export type RelationshipLookupRequest = {
  url: string;
  options: RequestInit & {
    method: "GET";
    credentials: "include";
    headers: Record<string, string>;
  };
};

/** The authenticated session's own relationship to a target account, per
 *  friendships/show.json's `relationship.source` object. */
export type RelationshipStatus = { blocking: boolean; muting: boolean };

// Same session-authenticated conventions as createDirectActionRequest (bearer + ct0),
// per ADR-0001: the confirmation call rides the same plumbing as the action calls.
export function createRelationshipLookupRequest(username: string): RelationshipLookupRequest {
  const { normalizedUsername, csrfToken } = requireSessionAuth("relationship lookup", username);

  const query = new URLSearchParams({ target_screen_name: normalizedUsername }).toString();
  return {
    url: `${getXApiBaseUrl()}${RELATIONSHIP_LOOKUP_ENDPOINT}?${query}`,
    options: {
      method: "GET",
      credentials: "include",
      headers: sessionAuthHeaders(csrfToken),
    },
  };
}

/** Parse friendships/show.json's body into the two flags the bulk runner confirms
 *  against. Missing/malformed bodies read as `false` on both -- a confirmation that
 *  cannot be read is not a confirmation, so the runner treats it as "not yet". */
export function parseRelationshipResponse(text: string): RelationshipStatus {
  const body = safeParseJson(text);
  const relationship = readProp(body, "relationship");
  const source = readProp(relationship, "source");
  return {
    blocking: readProp(source, "blocking") === true,
    muting: readProp(source, "muting") === true,
  };
}

async function fetchRelationshipStatus(username: string): Promise<RelationshipStatus> {
  const request = createRelationshipLookupRequest(username);
  const response = await fetch(request.url, request.options);
  ensureOk(response, "Relationship lookup failed");
  return parseRelationshipResponse(await response.text());
}

// Same shape as DIRECT_ACTION_ENDPOINTS above: which RelationshipStatus flag confirms
// each action type, as a map rather than a recurring type === "block" ? ... : ... .
const RELATIONSHIP_STATUS_FIELD: Record<DirectActionType, keyof RelationshipStatus> = {
  block: "blocking",
  mute: "muting",
};

/** Ground truth for whether the session user is actually blocking/muting `username`
 *  right now -- an HTTP 2xx on the create call is no longer sufficient on its own
 *  (see docs/adr/0004-bulk-confirm-and-retry.md). Propagates lookup failures so the
 *  bulk runner's retry loop can classify and back off on them like any other attempt. */
export async function confirmDirectAction(
  type: DirectActionType,
  username: string,
): Promise<boolean> {
  const status = await fetchRelationshipStatus(username);
  return status[RELATIONSHIP_STATUS_FIELD[type]];
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
