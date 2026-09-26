// Pure, dependency-free sync logic for the whitelist's cloud mirror.
//
// The whitelist's local form is a plain string[] (the set itself), so unlike the
// blocked ledger there is no local history to roll up — the cloud row is one row per
// handle carrying the last decision: `status: "active" | "removed"` plus the
// `updatedAt` that decides conflicts. This deliberately reuses the
// `blockedAccounts.status` precedent (ADR-0002): a removal is a status flip with a
// bumped timestamp, never a hard delete, so "removed on device A" is a fact that can
// propagate to device B on pull instead of a disappearance indistinguishable from
// "never added".
//
// TWO operators live here, mirroring blocked-merge.ts's discipline of keeping folds
// pure and shared across runtimes:
//   - applyWhitelistUpsert — the cloud-side "last-write-wins" fold, imported by
//     convex/whitelist.ts exactly like convex/blocked.ts imports applyAccountRollup.
//   - reconcileWhitelist — the client-side pull merge: union remote `active` rows in,
//     drop local entries whose remote row is `removed`, and never clobber a
//     still-pending (not-yet-pushed) local change.

export type WhitelistEntryStatus = "active" | "removed";

/** One queued whitelist change awaiting a push to the cloud backup. The shape family
 *  matches `OutboxItem` in blocked-store.ts: a client-generated `actionId` is the
 *  idempotency key, `at` is the local decision's timestamp. */
export type WhitelistOutboxItem = {
  handle: string;
  status: WhitelistEntryStatus;
  at: number;
  actionId: string;
};

/** Shape returned by the Convex `listWhitelist` query, merged back in on pull —
 *  every row for the owner in BOTH statuses; the client, not the query, decides what
 *  "active" means on merge. */
export type RemoteWhitelistEntry = {
  handle: string;
  status: WhitelistEntryStatus;
  updatedAt: number;
};

/** The cloud row's sync-relevant fields, minus the Convex table plumbing (`owner`)
 *  and document id — the same shape-vs-row split as blocked-merge.ts's AccountRollup. */
export type WhitelistEntryRollup = {
  handle: string;
  status: WhitelistEntryStatus;
  updatedAt: number;
  /** Idempotency key of the last applied upsert; a replayed push is a no-op. */
  lastClientActionId?: string;
};

/** One client upsert as the Convex mutation receives it. */
export type WhitelistUpsertInput = {
  handle: string;
  status: WhitelistEntryStatus;
  updatedAt: number;
  clientActionId: string;
};

/**
 * The "last-write-wins" operator for the cloud row: fold one upsert into the existing
 * row, returning the new row — or undefined when the upsert must not be applied:
 *
 *   - replay: the row's `lastClientActionId` already IS this action (a retried push
 *     re-applying itself), or
 *   - stale: the row carries a NEWER `updatedAt` than the incoming change (another
 *     device decided this handle later; that decision wins).
 *
 * A tie on `updatedAt` applies the incoming change (>=), so two devices that disagree
 * inside the same millisecond still converge on whichever push lands last.
 */
export function applyWhitelistUpsert(
  existing: WhitelistEntryRollup | undefined,
  input: WhitelistUpsertInput,
): WhitelistEntryRollup | undefined {
  if (existing?.lastClientActionId === input.clientActionId) return undefined;
  if (existing && input.updatedAt < existing.updatedAt) return undefined;
  return {
    handle: input.handle,
    status: input.status,
    updatedAt: input.updatedAt,
    lastClientActionId: input.clientActionId,
  };
}

/**
 * Reconcile the local whitelist against the cloud mirror on pull. The local array IS
 * the whitelist, so this is a true-set reconcile, not just a union:
 *
 *   - remote `active` row for a handle missing locally  -> added (restore on a new
 *     device, or an add synced from another device);
 *   - remote `removed` row for a handle present locally -> dropped (a removal made
 *     on another device propagates here);
 *   - either way, a still-pending local outbox change for that handle whose `at` is
 *     newer than (or equal to) the row's `updatedAt` WINS and the row is skipped —
 *     the pending change will push later and flip the cloud row, so both sides
 *     converge on the most recent decision.
 *
 * Matching is case-insensitive (X handles are); existing local entries keep their own
 * casing and position, remote-only additions append in remote order.
 */
export function reconcileWhitelist(
  local: string[],
  remote: RemoteWhitelistEntry[],
  pending: WhitelistOutboxItem[],
): string[] {
  const pendingAt = new Map<string, number>();
  for (const item of pending) {
    const key = item.handle.toLowerCase();
    const seen = pendingAt.get(key);
    if (seen === undefined || item.at > seen) {
      pendingAt.set(key, item.at);
    }
  }

  const result = [...local];
  for (const row of remote) {
    const pendingChangedAt = pendingAt.get(row.handle.toLowerCase());
    if (pendingChangedAt !== undefined && pendingChangedAt >= row.updatedAt) continue;
    const index = result.findIndex((entry) => entry.toLowerCase() === row.handle.toLowerCase());
    if (row.status === "active") {
      if (index === -1) result.push(row.handle);
    } else if (index !== -1) {
      result.splice(index, 1);
    }
  }
  return result;
}
