import { v, type Infer } from "convex/values";

import { applyAccountRollup, sumAccountRollups } from "../entrypoints/lib/blocked-merge";
import { mutation, query, type MutationCtx } from "./_generated/server";

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
// append the event. The rollup arithmetic (a same-id upsert adds +1, an aliasKey
// migration SUMs the legacy handle row into the numeric one) is not reimplemented here —
// it comes from applyAccountRollup/sumAccountRollups in
// entrypoints/lib/blocked-merge.ts, shared with the local store per
// docs/adr/0002-shared-ledger-algebra.md.
//
// This handler runs in the Convex runtime and is not executed by the unit suite, so
// makeFakeCloud in test/blocked-store.test.ts exercises the same shared operators and
// BS-33/34/35 pin the +1/SUM distinction.
const recordActionArgs = {
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
};

const recordActionArgsValidator = v.object(recordActionArgs);
type RecordActionArgs = Infer<typeof recordActionArgsValidator>;

async function applyRecordAction(ctx: MutationCtx, args: RecordActionArgs): Promise<void> {
  const owner = OWNER;

  // Idempotency: if this exact client action was already recorded, do nothing.
  if (args.clientActionId) {
    const existingAction = await ctx.db
      .query("blockActions")
      .withIndex("by_owner_client", (q) =>
        q.eq("owner", owner).eq("clientActionId", args.clientActionId),
      )
      .first();
    if (existingAction) return;
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
        // The SUM operator: two distinct rows for the same person, folded into one.
        const summed = sumAccountRollups(account, aliasRow);
        await ctx.db.patch(account._id, {
          idUnknown: summed.idUnknown,
          firstActionAt: summed.firstActionAt,
          lastActionAt: summed.lastActionAt,
          blockCount: summed.blockCount,
          muteCount: summed.muteCount,
        });
        await ctx.db.delete(aliasRow._id);
        account = await ctx.db.get(account._id);
      }
    }
  }

  // The +1 operator: this action folded into the (possibly just-migrated) account row.
  const rollup = applyAccountRollup(account ?? undefined, {
    handle: args.handle,
    idUnknown: args.idUnknown,
    xUserId: args.xUserId,
    kind: args.kind,
    at: args.at,
  });

  if (!account) {
    await ctx.db.insert("blockedAccounts", {
      owner,
      xUserId: args.xUserId,
      handle: rollup.handle,
      idUnknown: rollup.idUnknown,
      firstActionAt: rollup.firstActionAt,
      lastActionAt: rollup.lastActionAt,
      blockCount: rollup.blockCount,
      muteCount: rollup.muteCount,
      status: rollup.status,
    });
  } else {
    await ctx.db.patch(account._id, {
      handle: rollup.handle,
      idUnknown: rollup.idUnknown,
      firstActionAt: rollup.firstActionAt,
      lastActionAt: rollup.lastActionAt,
      blockCount: rollup.blockCount,
      muteCount: rollup.muteCount,
      status: rollup.status,
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
}

export const recordAction = mutation({
  args: recordActionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyRecordAction(ctx, args);
    return null;
  },
});

// Batched form of recordAction: one HTTP round-trip and one transaction for a whole
// outbox chunk. The client previously pushed one mutation per queued action, so a
// 50-reply bulk block cost ~50 sequential round-trips (~15s at ~300ms RTT); this
// collapses that to one. Each item keeps its own clientActionId idempotency, so a
// retried chunk never double-records.
export const recordActions = mutation({
  args: { actions: v.array(recordActionArgsValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const action of args.actions) {
      await applyRecordAction(ctx, action);
    }
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
