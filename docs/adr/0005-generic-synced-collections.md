# ADR-0005 — One sync engine for every synced collection; the whitelist mirrors as status rows

- Status: Accepted
- Date: 2026-09-26

## Context

Cloud backup mirrored only the blocked list. The whitelist lived only in
`chrome.storage.local`, so a device switch or reinstall lost it (issue #47).

ADR-0003 made "when do we sync" a single written-down policy, and it rejected a deeper
`SyncEngine` object "for now", to revisit "if the sync surface grows again". A second
list to mirror is that growth. A second, copied engine would recreate the failure
ADR-0003 fixed: two triggers that decide "when do we sync" differently.

The whitelist also differs from the blocked list in one way that matters. Its local form
is the set itself (`string[]`), not an action ledger with rollups. A removal therefore
deletes a local entry, and a later pull cannot tell "removed on another device" from
"never added" unless the cloud records the removal.

## Options considered

### A. A second, whitelist-only engine and toggle — REJECTED

This is the least code to write. It duplicates the policy, the scheduler hookup and the
Cloud pane wiring, which is the drift ADR-0003 removed. The spec also asks for one
"Cloud backup" switch for both lists.

### B. ADR-0003's option A: one `SyncEngine` object that replaces `background-sync.ts` — REJECTED again

It would absorb the debounce, alarm and eviction catch-up into a new object. None of
that machinery changes for a second list. It only needs to watch a second outbox key.
Rewriting it buys no behaviour.

### C. Make the existing engine functions generic over a synced collection — ADOPTED

The engine keeps its shape, but each function takes a collection argument.

### Cloud row shape for the whitelist

- **Hard delete on removal** — rejected. A removal would vanish, and the next pull from
  a device that still holds the handle would bring it back.
- **Append-only action ledger, like the blocked list** — rejected. The whitelist has no
  counters or history to roll up. A ledger would add the ADR-0002 fold algebra for no
  benefit.
- **One row per handle with a status flip** — adopted. This is the `blockedAccounts`
  `active | unblocked` precedent from ADR-0002.

## Decision

- A **synced collection** is a local-store port (`pending`, `markSynced`,
  `mergeRemote`, optional `backfill`) plus a lazy loader for its `CloudAdapter`, plus
  its own sync-meta storage key. `sync-engine.ts` defines two: `blockedCollection` and
  `whitelistCollection`. `runCloudSync` and `runAutoCloudSync` take a collection.
- **One policy, applied per collection.** `runAutoCloudSyncAll` asks `shouldAutoSync`
  about each collection. If any is due, it syncs all of them. If none is due, it loads
  no adapter. The background scheduler, the popup and the Cloud pane all call the
  `...All` drivers, under the one `CLOUD_BACKUP_KEY` switch.
- **Per-collection sync meta.** The blocked list keeps its existing `cloudSyncMeta` key,
  so upgrades keep their last-sync stamp. The whitelist uses `whitelistSyncMeta`. A
  surface that shows one age line shows the oldest stamp, so it never overstates
  freshness.
- **The whitelist cloud row** (`whitelistEntries`) is one row per owner and lowercased
  handle, with `status: "active" | "removed"` and `updatedAt`. Rows are never
  hard-deleted. The upsert is last-write-wins on `updatedAt` (a tie applies the
  arrival), and a replayed `clientActionId` is a no-op. That fold is
  `applyWhitelistUpsert` in `packages/storage/whitelist-merge.ts`. `convex/whitelist.ts`
  imports it, and a fake-cloud test pins it, following the ADR-0002 pattern.
- **Pull is a true-set reconcile.** A remote `active` row adds a missing handle. A remote
  `removed` row drops a local one. A still-pending local change for that handle wins
  when its time is newer than or equal to the row's `updatedAt`, because it will push
  and flip the row.
- **First sync backfills.** When the whitelist has no `lastSyncAt`, every local handle is
  queued as `active` before the push. Upgrading with a local-only whitelist therefore
  fills the cloud instead of looking wiped.
- **"Wipe cloud data" stays blocklist-only.** `CloudAdapter.clear` is optional. Only the
  blocked list's adapter has it, and the wipe never touches whitelist rows or the
  whitelist outbox.

## Consequences

- Adding a third synced collection means a store port, an adapter, a meta key and one
  entry in `SYNCED_COLLECTIONS`. The policy and scheduler need no change.
- `runCloudSyncAll` runs the collections in order and stops at the first error. If the
  whitelist push fails, the blocked list has already synced and stamped its meta, but
  the surface reports "Sync failed". The outbox keeps the failed changes for the next run.
- A build pointed at a deployment without the `whitelist:*` functions fails every sync
  at the whitelist step. Deploy the Convex functions before shipping a client that
  syncs the whitelist.
- Last-write-wins compares device clocks. A device with a badly wrong clock can win or
  lose a conflict it should not. This matches the blocked list's existing behaviour, and
  there is no conflict UI.
- After an upgrade, the first popup open or background wake runs one sync even when the
  blocked list is fresh, because the whitelist has never synced.
