import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const kindValidator = v.union(v.literal("block"), v.literal("mute"), v.literal("unblock"));
const sourceValidator = v.union(
  v.literal("reply-bar"),
  v.literal("popup"),
  v.literal("import"),
  v.literal("background"),
);

// Every row is scoped to the authenticated user's identity subject (the Google `sub`).
async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated. Sign in before syncing your blocked list.");
  }
  return identity.subject;
}

// Upsert keyed on (owner, xUserId): never duplicate the id, just roll the counts up and
// append the event. This mirrors mergeBlockedAccount in entrypoints/lib/blocked-merge.ts,
// whose behavior is pinned by test/blocked-store.test.js.
export const recordAction = mutation({
  args: {
    xUserId: v.string(),
    handle: v.string(),
    idUnknown: v.boolean(),
    kind: kindValidator,
    at: v.number(),
    source: sourceValidator,
    clientActionId: v.optional(v.string()),
    fromAccount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);

    // Idempotency: if this exact client action was already recorded, do nothing.
    if (args.clientActionId) {
      const existingAction = await ctx.db
        .query("blockActions")
        .withIndex("by_owner_client", (q) =>
          q.eq("owner", owner).eq("clientActionId", args.clientActionId),
        )
        .first();
      if (existingAction) return null;
    }

    const account = await ctx.db
      .query("blockedAccounts")
      .withIndex("by_owner_xid", (q) => q.eq("owner", owner).eq("xUserId", args.xUserId))
      .unique();

    const status = args.kind === "unblock" ? "unblocked" : "active";

    if (!account) {
      await ctx.db.insert("blockedAccounts", {
        owner,
        xUserId: args.xUserId,
        handle: args.handle,
        idUnknown: args.idUnknown,
        firstActionAt: args.at,
        lastActionAt: args.at,
        blockCount: args.kind === "block" ? 1 : 0,
        muteCount: args.kind === "mute" ? 1 : 0,
        status,
      });
    } else {
      const isNewer = args.at >= account.lastActionAt;
      await ctx.db.patch(account._id, {
        handle: isNewer ? args.handle : account.handle,
        idUnknown: account.idUnknown && args.idUnknown,
        firstActionAt: Math.min(account.firstActionAt, args.at),
        lastActionAt: Math.max(account.lastActionAt, args.at),
        blockCount: account.blockCount + (args.kind === "block" ? 1 : 0),
        muteCount: account.muteCount + (args.kind === "mute" ? 1 : 0),
        status,
      });
    }

    await ctx.db.insert("blockActions", {
      owner,
      xUserId: args.xUserId,
      kind: args.kind,
      at: args.at,
      source: args.source,
      ...(args.fromAccount ? { fromAccount: args.fromAccount } : {}),
      ...(args.clientActionId ? { clientActionId: args.clientActionId } : {}),
    });

    return null;
  },
});

// All of the signed-in owner's blocked accounts, shaped for the local store's mergeRemote.
export const listBlocked = query({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);
    const accounts = await ctx.db
      .query("blockedAccounts")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .collect();

    return accounts.map((account) => ({
      xUserId: account.xUserId,
      handle: account.handle,
      idUnknown: account.idUnknown,
      firstActionAt: account.firstActionAt,
      lastActionAt: account.lastActionAt,
      blockCount: account.blockCount,
      muteCount: account.muteCount,
      status: account.status,
    }));
  },
});

// "Delete my cloud data": remove every account and action for the signed-in owner.
export const clearOwner = mutation({
  args: {},
  handler: async (ctx) => {
    const owner = await requireOwner(ctx);

    const accounts = await ctx.db
      .query("blockedAccounts")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .collect();
    for (const account of accounts) {
      await ctx.db.delete(account._id);
    }

    const actions = await ctx.db
      .query("blockActions")
      .withIndex("by_owner_xid", (q) => q.eq("owner", owner))
      .collect();
    for (const action of actions) {
      await ctx.db.delete(action._id);
    }

    return null;
  },
});
