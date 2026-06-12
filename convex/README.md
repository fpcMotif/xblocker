# Convex cloud backup

This directory is the optional cloud backup for XBlocker's blocked-account list. It is
**opt-in** and the extension works fully without it — the local store
(`entrypoints/lib/blocked-store.ts`) is always the source of truth; Convex is a mirror.

## What it does

- One row per blocked X account per signed-in user (`blockedAccounts`), keyed on the
  stable numeric id. The numeric id is **never duplicated**.
- One row per action (`blockActions`), so "blocked/muted the same person several times,
  from several of your own accounts" is recorded as history, not as duplicate accounts.
- Identity is the Google account you sign in with (OIDC); your backup follows you across
  machines and browser profiles.

## One-time setup

You need a [Convex](https://convex.dev) account and a Google OAuth client. None of this
can be provisioned from CI — run it locally.

### 1. Create the deployment

```bash
bun add -d convex            # already in devDependencies
npx convex dev               # logs in, creates a dev deployment, generates convex/_generated
```

`npx convex dev` prints your deployment URL (e.g. `https://your-app-123.convex.cloud`)
and keeps the schema + functions in sync.

### 2. Create a Google OAuth client

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID**.
2. Application type: **Web application** (the `chrome.identity` redirect uses an HTTPS
   `https://<extension-id>.chromiumapp.org/` URL).
3. Add the extension's redirect URL under **Authorized redirect URIs**. Get it by
   loading the unpacked extension and running `chrome.identity.getRedirectURL()` in the
   popup console, or compute it as `https://<your-extension-id>.chromiumapp.org/`.
4. Copy the **Client ID**.

### 3. Wire the env vars

In the Convex dashboard (Settings → Environment Variables) set:

```
GOOGLE_OAUTH_CLIENT_ID = <the OAuth client id from step 2>
```

`convex/auth.config.ts` reads this to validate incoming Google tokens (`aud` must match).

For the extension build, create a `.env` at the repo root (WXT/Vite loads `VITE_`-prefixed
vars into `import.meta.env`):

```
VITE_CONVEX_URL=https://your-app-123.convex.cloud
VITE_GOOGLE_OAUTH_CLIENT_ID=<the same OAuth client id>
```

Then rebuild: `bun run build`.

### 4. Use it

Open the extension popup → **Cloud backup** → toggle on → **Sign in**. From then on,
"Sync now" (and opening the popup with backup enabled) drains the local outbox to Convex
and pulls remote accounts back down.

## Notes

- The backup is driven from the popup, so it syncs whenever the popup is opened (or when
  you click "Sync now"). Pushing in real time from a background service worker is a
  reasonable future upgrade.
- "Delete my cloud data" maps to the `clearOwner` mutation (`clearCloud()` in
  `convex-sync.ts`).
- The dedup/rollup arithmetic mirrors `entrypoints/lib/blocked-merge.ts`, which is unit
  tested in `test/blocked-store.test.js`.
