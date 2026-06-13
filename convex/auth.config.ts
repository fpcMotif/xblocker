// No authentication: this is a single-user personal backup. The Convex functions in
// blocked.ts scope every row to one fixed owner and never call ctx.auth, so there are
// no identity providers to configure.
export default {
  providers: [],
};
