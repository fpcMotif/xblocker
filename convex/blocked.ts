import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

const kindValidator = v.union(v.literal("block"), v.literal("mute"), v.literal("unblock"));
const sourceValidator = v.union(
  v.literal("reply-bar"),
  v.literal("popup"),
  v.literal("import"),
  v.literal("background"),
);
const statusValidator = v.union(v.literal("active"), v.literal("unblocked"));

// Shape of each row returned by listBlocked — mirrors RemoteAccount in
// entrypoints/lib/blocked-store.ts (the local store's mergeRemote consumes it).
const remoteAccountValidator = v.object({
  xUserId: v.string(),
  handle: v.string(),
  idUnknown: v.boolean(),
  firstActionAt: v.number(),
  lastActionAt: v.number(),
  blockCount: v.number(),
  muteCount: v.number(),
  status: statusValidator,
});

// Single-user personal backup: every row is scoped to one fixed owner. There is no
// sign-in — the deployment is private to its owner, so we don't separate identities.
const OWNER = "local";

// Upsert keyed on (owner, xUserId): never duplicate the id, just roll the counts up and
// append the event. This mirrors mergeBlockedAccount in entrypoints/lib/blocked-merge.ts,
// whose mapping is pinned by test/blocked-store.test.ts (outboxItemToRecordArgs).
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
    // The account's prior "@handle" key, present once a numeric id is learned for an
    // account the cloud first stored by handle. Lets us fold that legacy row into the
    // numeric one so one person is never two rows.
    aliasKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = OWNER;

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

    const byXid = (xid: string) =>
      ctx.db
        .query("blockedAccounts")
        .withIndex("by_owner_xid", (q) => q.eq("owner", owner).eq("xUserId", xid))
        // .first() (not .unique()) so a stray duplicate self-heals instead of wedging sync.
        .first();

    let account = await byXid(args.xUserId);

    // Migration: this action carries a numeric id for an account previously keyed by
    // "@handle". Re-key that legacy row (or fold it into the existing numeric row) so the
    // two never coexist on a pull-only client.
    if (args.aliasKey && args.aliasKey !== args.xUserId) {
      const aliasRow = await byXid(args.aliasKey);
      if (aliasRow) {
        if (!account) {
          await ctx.db.patch(aliasRow._id, { xUserId: args.xUserId, idUnknown: false });
          account = await ctx.db.get(aliasRow._id);
        } else if (aliasRow._id !== account._id) {
          await ctx.db.patch(account._id, {
            idUnknown: account.idUnknown && aliasRow.idUnknown,
            firstActionAt: Math.min(account.firstActionAt, aliasRow.firstActionAt),
            lastActionAt: Math.max(account.lastActionAt, aliasRow.lastActionAt),
            blockCount: account.blockCount + aliasRow.blockCount,
            muteCount: account.muteCount + aliasRow.muteCount,
          });
          await ctx.db.delete(aliasRow._id);
          account = await ctx.db.get(account._id);
        }
      }
    }

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
  returns: v.array(remoteAccountValidator),
  handler: async (ctx) => {
    const owner = OWNER;
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
  returns: v.null(),
  handler: async (ctx) => {
    const owner = OWNER;

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
