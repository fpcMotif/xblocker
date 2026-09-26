import { v } from "convex/values";

import { applyWhitelistUpsert } from "../packages/storage/whitelist-merge";
import { mutation, query } from "./_generated/server";

// Shape of each row returned by listWhitelist — mirrors RemoteWhitelistEntry in
// packages/storage/whitelist-merge.ts (the local store's mergeRemote consumes it).
const remoteWhitelistEntryValidator = v.object({
  handle: v.string(),
  status: v.union(v.literal("active"), v.literal("removed")),
  updatedAt: v.number(),
});

// Single-user personal backup: every row is scoped to one fixed owner, the same
// single-user-backup model as blockedAccounts. There is no sign-in — the deployment
// is private to its owner, so we don't separate identities.
const OWNER = "local";

const upsertEntryArgs = {
  handle: v.string(), // lowercased by the client wire mapping (whitelist-wire.ts)
  status: v.union(v.literal("active"), v.literal("removed")),
  updatedAt: v.number(),
  clientActionId: v.string(),
};

// Batched upsert-by-handle: one HTTP round-trip and one transaction for a whole
// outbox chunk. The last-write-wins arithmetic (apply on newer-or-equal updatedAt,
// no-op on a replayed clientActionId) is not reimplemented here — it comes from
// applyWhitelistUpsert in packages/storage/whitelist-merge.ts, shared with the local
// store per docs/adr/0002-shared-ledger-algebra.md's pattern.
//
// This handler runs in the Convex runtime and is not executed by the unit suite, so a
// fake-cloud test in packages/storage/tests/whitelist-store.test.ts exercises the same
// shared fold and pins the replay/stale/apply distinctions.
export const upsertWhitelistEntries = mutation({
  args: { entries: v.array(v.object(upsertEntryArgs)) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query("whitelistEntries")
        .withIndex("by_owner_handle", (q) =>
          q.eq("owner", OWNER).eq("handle", entry.handle),
        )
        // .first() (not .unique()) so a stray duplicate self-heals instead of wedging sync.
        .first();

      const folded = applyWhitelistUpsert(existing ?? undefined, entry);
      if (!folded) continue; // replayed or stale upsert: the row already won
      if (existing) {
        await ctx.db.patch(existing._id, folded);
      } else {
        await ctx.db.insert("whitelistEntries", { owner: OWNER, ...folded });
      }
    }
    return null;
  },
});

// All of the owner's whitelist entries in BOTH statuses, shaped for the local store's
// mergeRemote — the client, not the query, decides what "active" means on merge (a
// "removed" row is how a deletion propagates).
export const listWhitelist = query({
  args: {},
  returns: v.array(remoteWhitelistEntryValidator),
  handler: async (ctx) => {
    const entries = await ctx.db
      .query("whitelistEntries")
      .withIndex("by_owner", (q) => q.eq("owner", OWNER))
      .collect();

    return entries.map((entry) => ({
      handle: entry.handle,
      status: entry.status,
      updatedAt: entry.updatedAt,
    }));
  },
});
