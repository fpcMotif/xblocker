// Convex authentication configuration.
//
// We accept Google-issued OpenID Connect (OIDC) ID tokens directly. The extension
// obtains a Google ID token via chrome.identity (see entrypoints/lib/convex-sync.ts)
// and passes it to Convex; Convex validates it against Google's published keys. The
// token's `sub` claim becomes `ctx.auth.getUserIdentity().subject`, which we use as the
// per-user `owner`.
//
// Set GOOGLE_OAUTH_CLIENT_ID in the Convex dashboard (Settings → Environment Variables)
// to the same OAuth client id the extension uses. It must equal the token's `aud`.
export default {
  providers: [
    {
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    },
  ],
};
