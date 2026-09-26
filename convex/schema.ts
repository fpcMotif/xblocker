import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Cloud mirror of the local blocked-account store. The dedup invariant — one row per
// (owner, xUserId), many action events — is enforced in the recordAction mutation
// (Convex has no DB-level unique constraint), mirroring packages/storage/blocked-merge.ts.
export default defineSchema({
  // ONE row per blocked X account per owner. Unique key: (owner, xUserId).
  blockedAccounts: defineTable({
    owner: v.string(), // always the fixed literal "local" — single-owner backup, no auth
    xUserId: v.string(), // X numeric id_str, or "@handle" when the id is unknown
    handle: v.string(), // last-known @screen_name (display; may go stale)
    idUnknown: v.boolean(),
    firstActionAt: v.number(),
    lastActionAt: v.number(),
    blockCount: v.number(), // denormalized rollups for cheap display
    muteCount: v.number(),
    status: v.union(v.literal("active"), v.literal("unblocked")),
  })
    .index("by_owner_xid", ["owner", "xUserId"])
    .index("by_owner", ["owner"]),

  // MANY action events per account — the "blocked/muted several times" history.
  blockActions: defineTable({
    owner: v.string(),
    xUserId: v.string(),
    kind: v.union(v.literal("block"), v.literal("mute"), v.literal("unblock")),
    fromAccount: v.optional(v.string()), // which of YOUR X accounts performed it
    at: v.number(),
    source: v.union(
      v.literal("reply-bar"),
      v.literal("popup"),
      v.literal("import"),
      v.literal("background"),
      v.literal("auto"),
    ),
    clientActionId: v.optional(v.string()), // idempotency key from the client outbox
  })
    .index("by_owner_xid", ["owner", "xUserId"])
    .index("by_owner_client", ["owner", "clientActionId"]),

  // Cloud mirror of the local whitelist. ONE row per (owner, handle), handle
  // lowercased (X handles are case-insensitive). NO hard deletes: a removal flips
  // `status` to "removed" and bumps `updatedAt` — the blockedAccounts status-flip
  // precedent (ADR-0002) — so a removal made on one device propagates to the others
  // on pull instead of looking like "never whitelisted".
  whitelistEntries: defineTable({
    owner: v.string(), // always the fixed literal "local" — single-owner backup, no auth
    handle: v.string(), // lowercased X @screen_name (no leading @)
    status: v.union(v.literal("active"), v.literal("removed")),
    updatedAt: v.number(), // last-write-wins clock
    lastClientActionId: v.optional(v.string()), // idempotency key from the client outbox
  })
    .index("by_owner_handle", ["owner", "handle"])
    .index("by_owner", ["owner"]),
});
