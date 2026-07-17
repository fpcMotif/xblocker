export type QuickBlockMode = "inline" | "auto-confirm" | "off";

export const DEFAULT_QUICK_BLOCK_MODE: QuickBlockMode = "auto-confirm";

/** Validate an arbitrary flag value, falling back to the default mode. */
export function normalizeQuickBlockMode(raw: unknown): QuickBlockMode {
  if (raw === "inline" || raw === "auto-confirm" || raw === "off") {
    return raw;
  }
  return DEFAULT_QUICK_BLOCK_MODE;
}

/** The build-time strategy from VITE_QUICK_BLOCK_MODE. */
export function resolveQuickBlockMode(): QuickBlockMode {
  return normalizeQuickBlockMode(import.meta.env["VITE_QUICK_BLOCK_MODE"]);
}
