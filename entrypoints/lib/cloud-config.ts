/** Build-time Cloud backup availability without importing the Convex client bundle. */
export function isCloudConfigured(): boolean {
  return Boolean(import.meta.env["VITE_CONVEX_URL"]);
}
