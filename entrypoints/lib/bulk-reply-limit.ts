import { storageGetStrict, storageRemoveStrict, storageSetStrict } from "./chrome-storage";
import { createExclusiveRunner } from "./exclusive-lock";

const BULK_REPLY_LIMIT_KEY = "bulkReplyLimit";
const LEGACY_SETTINGS_KEY = "settings";
export const BULK_REPLY_LIMIT_BOUNDS = { min: 1, max: 200 } as const;
const DEFAULT_BULK_REPLY_LIMIT = 50;

export type BulkReplyLimit = {
  read(): Promise<number>;
  migrate(): Promise<number>;
  set(candidate: number): Promise<number>;
};

const runLimitMutation = createExclusiveRunner("xblocker-bulk-reply-limit");

function legacyLimit(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "maxReplies" in value) {
    return value.maxReplies;
  }
  return undefined;
}

function normalizeStoredLimit(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  const parsed = Math.trunc(numeric);
  if (!Number.isFinite(parsed)) return DEFAULT_BULK_REPLY_LIMIT;
  return Math.min(BULK_REPLY_LIMIT_BOUNDS.max, Math.max(BULK_REPLY_LIMIT_BOUNDS.min, parsed));
}

export const bulkReplyLimit: BulkReplyLimit = {
  async read() {
    const [stored, legacy] = await Promise.all([
      storageGetStrict<unknown>(BULK_REPLY_LIMIT_KEY),
      storageGetStrict<unknown>(LEGACY_SETTINGS_KEY),
    ]);

    return stored === undefined
      ? normalizeStoredLimit(legacyLimit(legacy))
      : normalizeStoredLimit(stored);
  },

  migrate() {
    return runLimitMutation(async () => {
      const [stored, legacy] = await Promise.all([
        storageGetStrict<unknown>(BULK_REPLY_LIMIT_KEY),
        storageGetStrict<unknown>(LEGACY_SETTINGS_KEY),
      ]);
      const normalized =
        stored === undefined
          ? normalizeStoredLimit(legacyLimit(legacy))
          : normalizeStoredLimit(stored);
      if (stored !== normalized) {
        await storageSetStrict({ [BULK_REPLY_LIMIT_KEY]: normalized });
      }
      if (legacy !== undefined) await storageRemoveStrict(LEGACY_SETTINGS_KEY);
      return normalized;
    });
  },

  set(candidate) {
    return runLimitMutation(async () => {
      if (!Number.isFinite(candidate)) {
        throw new Error("Bulk reply limit must be a finite number.");
      }
      const normalized = normalizeStoredLimit(candidate);
      await storageSetStrict({ [BULK_REPLY_LIMIT_KEY]: normalized });
      return normalized;
    });
  },
};
