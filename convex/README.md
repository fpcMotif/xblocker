# Convex cloud backup

This directory is the optional cloud backup for XBlocker's blocked-account list. It is
**opt-in** and the extension works fully without it — the local store
(`entrypoints/lib/blocked-store.ts`) is always the source of truth; Convex is a mirror.

## What it does

- One row per blocked X account (`blockedAccounts`), keyed on the stable numeric id once
  known (otherwise `@handle`). The account is **never duplicated** — repeat actions roll
  the counts up; once an id is learned, the handle-keyed row is folded into the numeric one.
- One row per action (`blockActions`), so "blocked/muted the same person several times,
  from several of your own accounts" is recorded as history, not as duplicate accounts.
- Queued actions are pushed in **batches** (`recordActions`, 50 per round-trip, one
  transaction each) instead of one mutation per action, so draining a bulk run's outbox
  costs ~0.5s rather than ~15s. Every action carries a client-generated idempotency id
  (`clientActionId`), so a retried chunk never double-records.
- `cloudOwners` holds one generation per owner. Every push carries that generation; a
  stale device is rejected after a wipe instead of recreating deleted rows. Pulls return
  the generation with their accounts, and the extension turns backup off on a mismatch.
- `cloudWipes` stores a durable receipt for every wipe id. `wipeOwner(wipeId)` increments
  the generation and deletes the owner's rows in one transaction. Retrying any earlier
  `wipeId` does no delete and returns the current generation.
- Sync runs automatically: the background worker drains the outbox shortly after it grows
  (debounced) and on a 30-minute alarm, and the popup syncs on open when backup is on and
  something is queued or the last pull is stale.

## No sign-in (single-owner)

There is **no authentication**. This is a single-user personal backup: every row is scoped
to one fixed owner (`OWNER = "local"` in `blocked.ts`), and `auth.config.ts` declares no
providers. The functions never call `ctx.auth`.

> **Security:** because there is no auth, anyone who knows your deployment URL can read,
> write, and clear your backup. Keep `VITE_CONVEX_URL` private (it ships in the built
> extension bundle, so only install builds you trust).

## One-time setup

You need a [Convex](https://convex.dev) account. This cannot be provisioned from CI — run
it locally.

### 1. Create the deployment

```bash
bun add convex               # already in dependencies
npx convex dev               # logs in, creates a dev deployment, generates convex/_generated
```

`npx convex dev` prints your deployment URL (e.g. `https://your-app-123.convex.cloud`)
and keeps the schema + functions in sync. Use `bunx convex deploy` (or `bun run
convex:deploy`) for a production deployment.

### 2. Point the extension at it

Create a `.env` at the repo root (WXT/Vite loads `VITE_`-prefixed vars into
`import.meta.env`):

```
VITE_CONVEX_URL=https://your-app-123.convex.cloud
```

Then rebuild: `bun run build`.

### 3. Use it

Open the extension popup → **Cloud backup** → toggle on. From then on, "Sync now" (and
toggling backup on) drains the local outbox to Convex and pulls remote accounts back down.

## Notes

- The popup can sync on open or on demand. The background worker also drains queued
  actions after its debounce and on its 30-minute alarm.
- `wipeOwner` (`adapter.wipe(wipeId)` in `convex-sync.ts`) deletes every cloud row for
  the owner behind a generation fence. Toggling backup off only stops syncing; it does
  not delete the cloud copy.
- The dedup/rollup arithmetic mirrors `entrypoints/lib/blocked-merge.ts`, and the
  client→cloud argument mapping (`outboxItemToRecordArgs`) is unit tested in
  `test/blocked-store.test.ts`.
- Bun does not run Convex mutations in this repo. The Bun suite models durable receipt
  behavior (wipe A, wipe B, retry A); the `wipeOwner` transaction itself needs a deployed
  Convex check or a future Convex-compatible test harness.
