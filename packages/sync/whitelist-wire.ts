// Pure Convex wire-format mapping for the whitelist mirror: WhitelistOutboxItem ->
// the cloud `upsertWhitelistEntries` mutation arguments. No chrome.* and no Convex SDK
// imports here — this module is unit-tested in isolation, and convex-sync.ts (the only
// Convex-aware module) imports it as a thin dependency rather than owning the mapping
// itself. Mirrors cloud-wire.ts exactly; kept as a package-root entry point (like
// cloud-wire.ts) so tests may import it under the packages/ deep-module rule.

import type { WhitelistOutboxItem } from "../storage/whitelist-store";

/** Arguments for one entry of the Convex `upsertWhitelistEntries` mutation. Built by
 *  `outboxItemToUpsertArgs` (kept here, not in convex-sync.ts, so the pure mapping is
 *  unit-tested). */
export type WhitelistUpsertArgs = {
  // The cloud row is keyed by the LOWERCASED handle: X handles are case-insensitive,
  // so the local entry's display casing must never fork the cloud into two rows.
  handle: string;
  status: "active" | "removed";
  updatedAt: number;
  clientActionId: string;
};

/** Map a queued whitelist outbox item to the cloud upsert arguments. */
export function outboxItemToUpsertArgs(item: WhitelistOutboxItem): WhitelistUpsertArgs {
  return {
    handle: item.handle.toLowerCase(),
    status: item.status,
    updatedAt: item.at,
    clientActionId: item.actionId,
  };
}

/** One chunk of outbox items ready for the batched `upsertWhitelistEntries` mutation:
 *  the mapped mutation args plus the action ids to mark synced once accepted, and the
 *  original items for symmetry with cloud-wire.ts's RecordBatch. */
export type WhitelistUpsertBatch = {
  args: WhitelistUpsertArgs[];
  actionIds: string[];
  items: WhitelistOutboxItem[];
};

/**
 * Split the whitelist outbox into chunks of at most `size` items, each mapped to the
 * batched `upsertWhitelistEntries` args. One chunk = one HTTP round-trip and one Convex
 * transaction — a large import queues one outbox entry per handle but still pushes in
 * batches, never one round-trip per handle. Kept here rather than in convex-sync.ts so
 * the mapping is unit-tested; convex-sync stays a thin I/O wrapper.
 */
export function whitelistOutboxToBatches(
  items: WhitelistOutboxItem[],
  size: number,
): WhitelistUpsertBatch[] {
  const chunkSize = Math.max(1, Math.trunc(size));
  const batches: WhitelistUpsertBatch[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    batches.push({
      args: chunk.map(outboxItemToUpsertArgs),
      actionIds: chunk.map((item) => item.actionId),
      items: chunk,
    });
  }
  return batches;
}
