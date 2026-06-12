// Convex cloud backup adapter.
//
// This module is the ONLY place that knows about Convex. It runs in the popup (an
// extension page), never in the content script, so all cross-origin traffic to
// *.convex.cloud and the Google OAuth flow stay out of x.com's context.
//
// Identity uses Convex's built-in OIDC support (see convex/auth.config.ts): the
// extension obtains a Google ID token via chrome.identity.launchWebAuthFlow and hands
// it to Convex, which validates it against Google's JWKS. `ctx.auth.getUserIdentity()`
// then yields the Google `sub`, which scopes every row to "you" across machines.
//
// Configuration (build-time env, e.g. a .env file WXT/Vite picks up):
//   VITE_CONVEX_URL                — your deployment URL, e.g. https://xyz.convex.cloud
//   VITE_GOOGLE_OAUTH_CLIENT_ID    — the OAuth client id whose redirect URI is the
//                                    extension's chrome.identity redirect URL.
//
// This file is intentionally excluded from unit tests: it requires a live deployment,
// a real Google client, and chrome.identity. Verify it manually per convex/README.md.

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import type { BlockedStatus } from "./blocked-merge";
import type { OutboxItem } from "./blocked-store";

type RecordActionArgs = {
  xUserId: string;
  handle: string;
  idUnknown: boolean;
  kind: "block" | "mute" | "unblock";
  at: number;
  source: "reply-bar" | "popup" | "import" | "background";
  clientActionId: string;
  fromAccount?: string;
};

/** Shape returned by the Convex `listBlocked` query. */
export type RemoteAccount = {
  xUserId: string;
  handle: string;
  idUnknown: boolean;
  firstActionAt: number;
  lastActionAt: number;
  blockCount: number;
  muteCount: number;
  status: BlockedStatus;
};

// Reference Convex functions by name so this bundle does not depend on the generated
// `convex/_generated/api`, which only exists after `npx convex dev`.
const recordActionRef = makeFunctionReference<"mutation", RecordActionArgs, null>(
  "blocked:recordAction",
);
const listBlockedRef = makeFunctionReference<"query", Record<string, never>, RemoteAccount[]>(
  "blocked:listBlocked",
);
const clearOwnerRef = makeFunctionReference<"mutation", Record<string, never>, null>(
  "blocked:clearOwner",
);

function readEnv(name: string): string | undefined {
  // import.meta.env is typed with a string index signature by Vite/WXT.
  return import.meta.env[name];
}

const CONVEX_URL = readEnv("VITE_CONVEX_URL");
const GOOGLE_CLIENT_ID = readEnv("VITE_GOOGLE_OAUTH_CLIENT_ID");

/** True when both the deployment URL and the Google client id are configured. */
export function isCloudConfigured(): boolean {
  return !!CONVEX_URL && !!GOOGLE_CLIENT_ID;
}

let httpClient: ConvexHttpClient | undefined;
function client(): ConvexHttpClient {
  if (!CONVEX_URL) {
    throw new Error("Convex deployment URL is not configured (set VITE_CONVEX_URL).");
  }
  httpClient ??= new ConvexHttpClient(CONVEX_URL);
  return httpClient;
}

type Identity = {
  idToken: string;
  email: string;
  subject: string;
  expiresAt: number;
};

let identity: Identity | undefined;

function randomToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(normalized);
  return JSON.parse(json);
}

// Run the Google OIDC implicit flow through chrome.identity and cache the ID token.
async function authenticate(interactive: boolean): Promise<Identity> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google OAuth client id is not configured (set VITE_GOOGLE_OAUTH_CLIENT_ID).");
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const nonce = randomToken();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    nonce,
    prompt: interactive ? "select_account" : "none",
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive });
  if (!responseUrl) {
    throw new Error("Sign-in was cancelled.");
  }

  const fragment = new URL(responseUrl).hash.slice(1);
  const idToken = new URLSearchParams(fragment).get("id_token");
  if (!idToken) {
    throw new Error("Google did not return an id_token. Check the OAuth client configuration.");
  }

  const payload = decodeJwtPayload(idToken);
  if (payload.nonce && payload.nonce !== nonce) {
    throw new Error("OAuth nonce mismatch; aborting.");
  }

  identity = {
    idToken,
    email: typeof payload.email === "string" ? payload.email : "",
    subject: typeof payload.sub === "string" ? payload.sub : "",
    expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 50 * 60 * 1000,
  };
  client().setAuth(idToken);
  return identity;
}

/** Interactive sign-in (must be triggered by a user gesture). */
export async function signIn(): Promise<{ email: string }> {
  const id = await authenticate(true);
  return { email: id.email };
}

/** Ensure a valid token without prompting; returns false if the user must sign in. */
export async function ensureAuth(): Promise<boolean> {
  if (identity && identity.expiresAt > Date.now() + 60_000) {
    client().setAuth(identity.idToken);
    return true;
  }
  try {
    await authenticate(false);
    return true;
  } catch {
    return false;
  }
}

export function signOut(): void {
  identity = undefined;
  client().clearAuth();
}

export function currentEmail(): string | undefined {
  return identity?.email;
}

/** Push queued local actions to Convex; returns the action ids that were accepted. */
export async function pushOutbox(items: OutboxItem[]): Promise<string[]> {
  const synced: string[] = [];
  for (const item of items) {
    // For id-unknown accounts the dedup key is the "@handle" string we stored locally.
    const xUserId = item.xUserId ?? item.accountKey;
    await client().mutation(recordActionRef, {
      xUserId,
      handle: item.handle,
      idUnknown: item.idUnknown,
      kind: item.action.kind,
      at: item.action.at,
      source: item.action.source,
      clientActionId: item.action.actionId,
      ...(item.action.fromAccount ? { fromAccount: item.action.fromAccount } : {}),
    });
    synced.push(item.action.actionId);
  }
  return synced;
}

/** Pull all of the signed-in owner's blocked accounts from Convex. */
export async function pullBlocked(): Promise<RemoteAccount[]> {
  return client().query(listBlockedRef, {});
}

/** Delete every cloud row for the signed-in owner ("delete my cloud data"). */
export async function clearCloud(): Promise<void> {
  await client().mutation(clearOwnerRef, {});
}
