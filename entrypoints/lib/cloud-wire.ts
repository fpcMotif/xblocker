// Pure Convex wire-format mapping: OutboxItem -> the cloud `recordAction`/`recordActions`
// mutation arguments. No chrome.* and no Convex SDK imports here — this module is
// unit-tested in isolation, and convex-sync.ts (the only Convex-aware module) imports it
// as a thin dependency rather than owning the mapping itself.

import type { OutboxItem } from "./blocked-store";
import type { BlockActionKind, BlockSource } from "./blocked-merge";

/** Arguments for the Convex `recordAction` mutation. Built by `outboxItemToRecordArgs`
 *  (kept here, not in convex-sync.ts, so the pure mapping is unit-tested). */
export type RecordActionArgs = {
  xUserId: string;
  handle: string;
  idUnknown: boolean;
  kind: BlockActionKind;
  at: number;
  source: BlockSource;
  clientActionId: string;
  fromAccount?: string;
  // The account's prior "@handle" key, sent only once a numeric id is learned, so the
  // cloud can fold a legacy handle-keyed row into the numeric one (one row per person).
  aliasKey?: string;
};

/**
 * Map a queued outbox item to the cloud `recordAction` arguments.
 *
 * The cloud row is keyed by the account's stable key: the numeric id once known,
 * otherwise "@handle". `aliasKey` carries the original "@handle" key whenever it differs
 * from the canonical key, which only happens after an id is learned for a handle-first
 * account — letting the cloud migrate the old row instead of creating a duplicate.
 */
export function outboxItemToRecordArgs(item: OutboxItem): RecordActionArgs {
  const xUserId = item.xUserId ?? item.accountKey;
  return {
    xUserId,
    handle: item.handle,
    idUnknown: item.idUnknown,
    kind: item.action.kind,
    at: item.action.at,
    source: item.action.source,
    clientActionId: item.action.actionId,
    ...(item.action.fromAccount ? { fromAccount: item.action.fromAccount } : {}),
    ...(item.accountKey !== xUserId ? { aliasKey: item.accountKey } : {}),
  };
}

/** One chunk of outbox items ready for the cloud's batched `recordActions` mutation:
 *  the mapped mutation args plus the action ids to mark synced once accepted, and the
 *  original items so a caller can fall back to per-item pushes. */
export type RecordBatch = {
  args: RecordActionArgs[];
  actionIds: string[];
  items: OutboxItem[];
};

/**
 * Split the outbox into chunks of at most `size` items, each mapped to the batched
 * `recordActions` args. One chunk = one HTTP round-trip and one Convex transaction;
 * pushing item-by-item made sync latency scale linearly with the outbox length
 * (~300ms per queued action). Kept here rather than in convex-sync.ts so the mapping
 * is unit-tested; convex-sync stays a thin I/O wrapper.
 */
export function outboxToRecordBatches(items: OutboxItem[], size: number): RecordBatch[] {
  const chunkSize = Math.max(1, Math.trunc(size));
  const batches: RecordBatch[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    const chunk = items.slice(start, start + chunkSize);
    batches.push({
      args: chunk.map(outboxItemToRecordArgs),
      actionIds: chunk.map((item) => item.action.actionId),
      items: chunk,
    });
  }
  return batches;
}
