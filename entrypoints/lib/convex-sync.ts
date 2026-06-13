// Convex cloud backup adapter.
//
// This module is the ONLY place that knows about Convex. It runs in the popup (an
// extension page), never in the content script, so all cross-origin traffic to
// *.convex.cloud stays out of x.com's context.
//
// There is NO authentication: this is a single-user personal backup. The Convex
// functions (convex/blocked.ts) scope every row to one fixed owner, so the extension
// just talks to the deployment directly. Keep the deployment URL private to you — the
// functions are reachable by anyone who knows it.
//
// Configuration (build-time env, e.g. a .env file WXT/Vite picks up):
//   VITE_CONVEX_URL — your deployment URL, e.g. https://your-app-123.convex.cloud

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

/** True when the deployment URL is configured. */
export function isCloudConfigured(): boolean {
  return !!CONVEX_URL;
}

let httpClient: ConvexHttpClient | undefined;
function client(): ConvexHttpClient {
  if (!CONVEX_URL) {
    throw new Error("Convex deployment URL is not configured (set VITE_CONVEX_URL).");
  }
  httpClient ??= new ConvexHttpClient(CONVEX_URL);
  return httpClient;
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

/** Pull all blocked accounts from Convex. */
export async function pullBlocked(): Promise<RemoteAccount[]> {
  return client().query(listBlockedRef, {});
}

/** Delete every cloud row ("delete my cloud data"). */
export async function clearCloud(): Promise<void> {
  await client().mutation(clearOwnerRef, {});
}
