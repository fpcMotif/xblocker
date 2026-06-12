// Pure, dependency-free logic for the blocked-account store.
//
// The core invariant (shared with the Convex cloud schema) is: never duplicate a
// blocked X account. There is exactly ONE record per account, keyed by the stable
// numeric user id when we know it, and every block / mute / unblock is appended to
// `actions[]` and rolled up into `blockCount` / `muteCount`. So "blocked the same
// person several times, from several of your accounts" is recorded as one account
// with many actions — not as duplicate rows.
//
// This module is imported by both the local store (`blocked-store.ts`) and the
// content script. The Convex mutation in `convex/blocked.ts` mirrors this rollup
// arithmetic against its two-table schema; these tests are the source of truth for
// the semantics.

export type BlockActionKind = "block" | "mute" | "unblock";
export type BlockSource = "reply-bar" | "popup" | "import" | "background";
export type BlockedStatus = "active" | "unblocked";

export type BlockAction = {
  // Client-generated unique id, used as the idempotency key for cloud sync so the
  // same action is never recorded twice in Convex even if a push is retried.
  actionId: string;
  kind: BlockActionKind;
  at: number;
  source: BlockSource;
  // Which of the user's own X accounts performed the action, when known.
  fromAccount?: string;
};

export type BlockedAccount = {
  // Dedup key: the numeric id when known, otherwise "@handle" (lower-cased).
  key: string;
  // Last-known @screen_name (no leading @). Display only; may go stale.
  handle: string;
  // True while we have only ever seen a screen name, never a numeric id.
  idUnknown: boolean;
  // X numeric id_str — stable for the life of the account — once captured.
  xUserId?: string;
  firstActionAt: number;
  lastActionAt: number;
  blockCount: number;
  muteCount: number;
  status: BlockedStatus;
  actions: BlockAction[];
};

export type RecordInput = {
  handle: string;
  kind: BlockActionKind;
  source: BlockSource;
  xUserId?: string;
  fromAccount?: string;
  at?: number;
  actionId?: string;
};

export type BlockedStats = {
  accounts: number;
  blocked: number;
  muted: number;
};

function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, "").trim();
}

/** The dedup key for an account: its numeric id, or "@handle" when the id is unknown. */
export function accountKeyFor(input: { xUserId?: string; handle: string }): string {
  return input.xUserId ? input.xUserId : `@${normalizeHandle(input.handle).toLowerCase()}`;
}

function makeAction(input: RecordInput, at: number, actionId: string): BlockAction {
  return {
    actionId,
    kind: input.kind,
    at,
    source: input.source,
    ...(input.fromAccount ? { fromAccount: input.fromAccount } : {}),
  };
}

/**
 * Merge a single action into an account record, deduping on the account key.
 *
 * @param existing the current record for this account, or undefined for a new one
 * @param input    the action being recorded
 * @param now      timestamp to use when `input.at` is omitted
 * @param genId    generator for the action's idempotency id when `input.actionId` is omitted
 */
export function mergeBlockedAccount(
  existing: BlockedAccount | undefined,
  input: RecordInput,
  now: number,
  genId: () => string,
): BlockedAccount {
  const at = input.at ?? now;
  const actionId = input.actionId ?? genId();
  const action = makeAction(input, at, actionId);
  const handle = normalizeHandle(input.handle);

  if (!existing) {
    return {
      key: accountKeyFor({ ...(input.xUserId ? { xUserId: input.xUserId } : {}), handle }),
      handle,
      idUnknown: !input.xUserId,
      ...(input.xUserId ? { xUserId: input.xUserId } : {}),
      firstActionAt: at,
      lastActionAt: at,
      blockCount: input.kind === "block" ? 1 : 0,
      muteCount: input.kind === "mute" ? 1 : 0,
      status: input.kind === "unblock" ? "unblocked" : "active",
      actions: [action],
    };
  }

  // We may now have learned a numeric id for an account previously keyed by handle.
  // We keep the existing map key stable (so the store never has to move entries) but
  // record the id and clear the idUnknown flag.
  const xUserId = input.xUserId ?? existing.xUserId;
  const isNewer = at >= existing.lastActionAt;

  return {
    ...existing,
    handle: isNewer ? handle : existing.handle,
    idUnknown: xUserId ? false : existing.idUnknown,
    ...(xUserId ? { xUserId } : {}),
    firstActionAt: Math.min(existing.firstActionAt, at),
    lastActionAt: Math.max(existing.lastActionAt, at),
    blockCount: existing.blockCount + (input.kind === "block" ? 1 : 0),
    muteCount: existing.muteCount + (input.kind === "mute" ? 1 : 0),
    status: input.kind === "unblock" ? "unblocked" : "active",
    actions: [...existing.actions, action],
  };
}

/** Roll a list of accounts up into the counters shown in the UI. */
export function summarizeAccounts(accounts: BlockedAccount[]): BlockedStats {
  let blocked = 0;
  let muted = 0;
  for (const account of accounts) {
    if (account.status !== "active") continue;
    if (account.blockCount > 0) blocked++;
    if (account.muteCount > 0) muted++;
  }
  return { accounts: accounts.length, blocked, muted };
}
