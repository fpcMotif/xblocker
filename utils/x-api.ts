import { parseUsername } from "./username";

/**
 * Everything XBlocker knows about X's private web API lives here: the web
 * client's public bearer token, the cookie/CSRF handshake, and the v1.1
 * action endpoints. Callers get typed results and never see a header.
 */

const X_WEB_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const X_API_BASE_URL = "https://api.x.com";

export type XApiRequest = {
  url: string;
  options: RequestInit & {
    method: "POST";
    credentials: "include";
    headers: Record<string, string>;
    body: string;
  };
};

export type XApiResult =
  | { ok: true }
  | { ok: false; reason: "rate-limited" | "request-failed"; status?: number; error?: unknown };

function getCookieValue(name: string): string {
  return (
    document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}

function createUserActionRequest(endpoint: string, username: string): XApiRequest {
  const screenName = parseUsername(username);
  if (!screenName) {
    throw new Error("Missing valid X username for direct action.");
  }

  const csrfToken = getCookieValue("ct0");
  if (!csrfToken) {
    throw new Error("Missing X CSRF token; open x.com while signed in and try again.");
  }

  return {
    url: `${X_API_BASE_URL}${endpoint}`,
    options: {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${X_WEB_BEARER_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Csrf-Token": csrfToken,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
      },
      body: new URLSearchParams({ screen_name: screenName }).toString(),
    },
  };
}

export function createDirectBlockRequest(username: string): XApiRequest {
  return createUserActionRequest("/1.1/blocks/create.json", username);
}

async function performUserAction(endpoint: string, username: string): Promise<XApiResult> {
  try {
    const request = createUserActionRequest(endpoint, username);
    const response = await fetch(request.url, request.options);
    if (response.ok) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: response.status === 429 ? "rate-limited" : "request-failed",
      status: response.status,
    };
  } catch (error) {
    return { ok: false, reason: "request-failed", error };
  }
}

export const xApi = {
  block: (username: string) => performUserAction("/1.1/blocks/create.json", username),
  mute: (username: string) => performUserAction("/1.1/mutes/users/create.json", username),
};
