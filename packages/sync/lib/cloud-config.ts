// Build-time cloud configuration — deliberately free of any Convex import. The
// cloud-session's configured probe reads this module so an unconfigured build never
// fetches or evaluates the Convex client chunk (ADR-0003's "must never pay for it"),
// while convex-sync reads the same two functions so there is one source of truth.

function readEnv(name: string): string | undefined {
  // import.meta.env is typed with a string index signature by Vite/WXT.
  return import.meta.env[name];
}

/** The configured Convex deployment URL, if the build has one. Read per call, not
 *  frozen at module load: which test first imports this module must not pin the value
 *  for the whole process (tests delete/restore VITE_CONVEX_URL), and in the extension
 *  the value is build-time inlined anyway so laziness costs nothing. */
export function readConvexUrl(): string | undefined {
  return readEnv("VITE_CONVEX_URL");
}

/** True when the deployment URL is configured. */
export function isCloudConfigured(): boolean {
  return !!readConvexUrl();
}
