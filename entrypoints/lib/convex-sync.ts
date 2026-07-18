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

import { outboxItemToRecordArgs, outboxToRecordBatches, type RecordActionArgs } from "./cloud-wire";
import type { OutboxItem, RemoteAccount } from "./blocked-store";
import type { CloudAdapter } from "./sync-engine";

// The Convex `listBlocked` query returns exactly the shape the local store's mergeRemote
// consumes, so re-export the single definition rather than maintaining a twin here.
export type { RemoteAccount };

// Reference Convex functions by name so this bundle does not depend on the generated
// `convex/_generated/api`, which only exists after `npx convex dev`.
const recordActionRef = makeFunctionReference<"mutation", RecordActionArgs, null>(
  "blocked:recordAction",
);
const recordActionsRef = makeFunctionReference<"mutation", { actions: RecordActionArgs[] }, null>(
  "blocked:recordActions",
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

/** True when the deployment URL is configured. Read per call, not frozen at module
 *  load: which test first imports this module must not pin the URL for the whole
 *  process (tests delete/restore VITE_CONVEX_URL), and in the extension the value is
 *  build-time inlined anyway so laziness costs nothing. */
export function isCloudConfigured(): boolean {
  return !!readEnv("VITE_CONVEX_URL");
}

let httpClient: ConvexHttpClient | undefined;
function client(): ConvexHttpClient {
  const url = readEnv("VITE_CONVEX_URL");
  if (!url) {
    throw new Error("Convex deployment URL is not configured (set VITE_CONVEX_URL).");
  }
  httpClient ??= new ConvexHttpClient(url);
  return httpClient;
}

/** Items per batched `recordActions` call. Well under Convex's per-mutation read/write
 *  limits (each item costs one index read plus at most three writes). */
const PUSH_BATCH_SIZE = 50;

// A deployment that predates the batched mutation rejects it with a "could not find
// public function" error; that is the only error worth degrading on.
function isMissingFunctionError(error: unknown): boolean {
  return error instanceof Error && /could not find.*function/i.test(error.message);
}

/** Push queued local actions to Convex; returns the action ids that were accepted.
 *  Batches of PUSH_BATCH_SIZE go through one `recordActions` round-trip each (pushing
 *  item-by-item made sync latency scale linearly with the outbox: ~300ms per action).
 *  Falls back to per-item `recordAction` when the deployment lacks the batched
 *  mutation. The OutboxItem -> args mapping lives in cloud-wire
 *  (`outboxToRecordBatches`) so it is unit-tested; this is the thin live-Convex I/O
 *  wrapper around it. */
export async function pushOutbox(items: OutboxItem[]): Promise<string[]> {
  const synced: string[] = [];
  let batchUnsupported = false;
  for (const batch of outboxToRecordBatches(items, PUSH_BATCH_SIZE)) {
    if (!batchUnsupported) {
      try {
        await client().mutation(recordActionsRef, { actions: batch.args });
        synced.push(...batch.actionIds);
        continue;
      } catch (error) {
        if (!isMissingFunctionError(error)) throw error;
        batchUnsupported = true;
      }
    }
    for (const item of batch.items) {
      await client().mutation(recordActionRef, outboxItemToRecordArgs(item));
      synced.push(item.action.actionId);
    }
  }
  return synced;
}

/** Pull all blocked accounts from Convex. */
export async function pullBlocked(): Promise<RemoteAccount[]> {
  return client().query(listBlockedRef, {});
}

/** Delete every cloud row ("delete my cloud data"). Throws when the deployment URL is
 *  not configured, so the cloud-session's default wipe port can delegate straight here
 *  without re-implementing the guard. Like `pushOutbox`/`pullBlocked`, this is thin
 *  live-Convex I/O — which is why the configured check lives in this coverage-exempt
 *  module rather than in cloud-session, where its happy path needs a live client (or
 *  the process-global module mocks the session design removed) to be exercised. */
export async function clearCloud(): Promise<void> {
  if (!isCloudConfigured()) {
    throw new Error("Convex deployment URL is not configured (set VITE_CONVEX_URL).");
  }
  await client().mutation(clearOwnerRef, {});
}

/** This adapter, wired to `sync-engine.ts`'s `CloudAdapter` seam: `runCloudSync` and
 *  `runAutoCloudSync` lazily import this module and use `convexAdapter` by default. */
export const convexAdapter = {
  isConfigured: isCloudConfigured,
  push: pushOutbox,
  pull: pullBlocked,
  clear: clearCloud,
} satisfies CloudAdapter;
