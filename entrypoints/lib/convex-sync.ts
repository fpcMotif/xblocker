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

import { outboxToRecordBatches, type FencedRecordActionArgs } from "./cloud-wire";
import type { OutboxItem, RemoteAccount } from "./blocked-store";
import type { CloudAdapter, CloudPullResult, CloudPushResult } from "./sync-engine";

// The Convex `listBlocked` query returns exactly the shape the local store's mergeRemote
// consumes, so re-export the single definition rather than maintaining a twin here.
export type { RemoteAccount };

// Reference Convex functions by name so this bundle does not depend on the generated
// `convex/_generated/api`, which only exists after `npx convex dev`.
type RecordResult = { accepted: boolean; generation: number };

const recordActionsRef = makeFunctionReference<
  "mutation",
  { actions: FencedRecordActionArgs[] },
  RecordResult
>("blocked:recordActions");
const listBlockedRef = makeFunctionReference<"query", Record<string, never>, CloudPullResult>(
  "blocked:listBlocked",
);
const wipeOwnerRef = makeFunctionReference<"mutation", { wipeId: string }, { generation: number }>(
  "blocked:wipeOwner",
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

/** Items per batched `recordActions` call. Well under Convex's per-mutation read/write
 *  limits (each item costs one index read plus at most three writes). */
const PUSH_BATCH_SIZE = 50;

/** Push queued local actions to Convex; returns the action ids that were accepted.
 *  Batches of PUSH_BATCH_SIZE go through one `recordActions` round-trip each (pushing
 *  item-by-item made sync latency scale linearly with the outbox: ~300ms per action).
 *  A missing fenced batch endpoint is an upgrade error, never a legacy per-item fallback. */
export async function pushOutbox(
  items: OutboxItem[],
  generation: number,
): Promise<CloudPushResult> {
  const synced: string[] = [];
  for (const batch of outboxToRecordBatches(items, PUSH_BATCH_SIZE, generation)) {
    const result = await client().mutation(recordActionsRef, { actions: batch.args });
    if (!result.accepted || result.generation !== generation) {
      return { status: "stale", generation: result.generation };
    }
    synced.push(...batch.actionIds);
  }
  return { status: "accepted", actionIds: synced, generation };
}

/** Pull all blocked accounts from Convex. */
export async function pullBlocked(): Promise<CloudPullResult> {
  return client().query(listBlockedRef, {});
}

/** Delete one generation of cloud data. Retrying the same wipeId is idempotent. */
async function wipeCloud(wipeId: string): Promise<number> {
  const result = await client().mutation(wipeOwnerRef, { wipeId });
  return result.generation;
}

/** This adapter, wired to `sync-engine.ts`'s `CloudAdapter` seam: `runCloudSync` and
 *  `runAutoCloudSync` lazily import this module and use `convexAdapter` by default. */
export const convexAdapter = {
  isConfigured: isCloudConfigured,
  push: pushOutbox,
  pull: pullBlocked,
  wipe: wipeCloud,
} satisfies CloudAdapter;
