// Pure, dependency-free logic for the blocked-account store.
//
// The core invariant (shared with the Convex cloud schema) is: never duplicate a
// blocked X account. There is exactly ONE record per account, keyed by the stable
// numeric user id when we know it, and every block / mute / unblock is appended to
// `actions[]` and rolled up into `blockCount` / `muteCount`. So "blocked the same
// person several times, from several of your accounts" is recorded as one account
// with many actions — not as duplicate rows.
//
// This module is imported by both the local store (`blocked-store.ts`) and the content
// script, and — per docs/adr/0002-shared-ledger-algebra.md — directly by
// `convex/blocked.ts`, which imports `applyAccountRollup` and `sumAccountRollups` rather
// than maintaining its own copy of the arithmetic.
//
// THREE distinct fold operators live here and must never be conflated:
//   - applyAccountRollup — the "+1" operator: one new action folded into a rollup.
//   - sumAccountRollups  — the "SUM" operator: two separate rows' histories merged
//     (e.g. a legacy handle row aliased into a numeric-id row).
//   - foldAccountSnapshot — the "max" operator: two already-rolled-up snapshots of the
//     SAME logical total reconciled on pull.
// Tests BS-33/34/35 (and the direct unit tests below them) pin the +1/SUM/max
// distinction; do not let any of the three borrow another's semantics.

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

function stripAtPrefix(handle: string): string {
  return handle.replace(/^@/, "").trim();
}

/** The dedup key for an account: its numeric id, or "@handle" when the id is unknown. */
export function accountKeyFor(input: { xUserId?: string; handle: string }): string {
  return input.xUserId ? input.xUserId : `@${stripAtPrefix(input.handle).toLowerCase()}`;
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
 * The account rollup fields shared between the local store's `BlockedAccount` and the
 * Convex `blockedAccounts` row — everything EXCEPT the shape-specific bookkeeping each
 * side keeps on its own (the local `key` map key and `actions[]` history; Convex's
 * `owner`/table plumbing). `applyAccountRollup` and `sumAccountRollups` operate purely
 * on this shape so both runtimes share one implementation of the arithmetic.
 */
export type AccountRollup = {
  handle: string;
  idUnknown: boolean;
  xUserId?: string;
  firstActionAt: number;
  lastActionAt: number;
  blockCount: number;
  muteCount: number;
  status: BlockedStatus;
};

/**
 * One action folded into a rollup by `applyAccountRollup`. `idUnknown` and `xUserId`
 * are passed explicitly rather than derived, so both the local wrapper (which infers
 * them from whether the action carries a numeric id) and the Convex mutation (which
 * receives them directly as call args) can drive the same function.
 */
export type AccountRollupInput = {
  handle: string;
  idUnknown: boolean;
  xUserId?: string;
  kind: BlockActionKind;
  at: number;
};

/**
 * The "+1" operator: fold one new action into a rollup, or start one if there isn't one
 * yet. Counters increment by the action's kind; `firstActionAt`/`lastActionAt` widen to
 * span the action; `idUnknown` is the AND of the existing and incoming flags (an input
 * carrying a known id passes `idUnknown: false`, which always clears it); `xUserId`
 * prefers the input's, falling back to the existing one, so a later-learned id is
 * adopted without ever regressing to unknown; the side with the newer `at` wins the
 * display handle; `status` always reflects this action's own kind.
 */
export function applyAccountRollup(
  existing: AccountRollup | undefined,
  input: AccountRollupInput,
): AccountRollup {
  if (!existing) {
    return {
      handle: input.handle,
      idUnknown: input.idUnknown,
      ...(input.xUserId ? { xUserId: input.xUserId } : {}),
      firstActionAt: input.at,
      lastActionAt: input.at,
      blockCount: input.kind === "block" ? 1 : 0,
      muteCount: input.kind === "mute" ? 1 : 0,
      status: input.kind === "unblock" ? "unblocked" : "active",
    };
  }

  const xUserId = input.xUserId ?? existing.xUserId;
  const isNewer = input.at >= existing.lastActionAt;

  return {
    ...existing,
    handle: isNewer ? input.handle : existing.handle,
    idUnknown: existing.idUnknown && input.idUnknown,
    ...(xUserId ? { xUserId } : {}),
    firstActionAt: Math.min(existing.firstActionAt, input.at),
    lastActionAt: Math.max(existing.lastActionAt, input.at),
    blockCount: existing.blockCount + (input.kind === "block" ? 1 : 0),
    muteCount: existing.muteCount + (input.kind === "mute" ? 1 : 0),
    status: input.kind === "unblock" ? "unblocked" : "active",
  };
}

/**
 * The "SUM" operator: fold two rows for the SAME logical account that were split by a
 * historical accident (a legacy "@handle" row later duplicated by one recorded with the
 * real numeric id) back into one. Distinct from `applyAccountRollup` (+1 one action) and
 * `foldAccountSnapshot` (max, two snapshots of one already-converged total): here the two
 * rows' full histories are summed. Extracted bit-for-bit from convex/blocked.ts's
 * alias-row fold: counters SUM, timestamps min/max, `idUnknown` AND. `handle`, `status`,
 * and `xUserId` are NOT recomputed here — `target` (the row callers keep) wins
 * unconditionally, matching the Convex patch, which never writes those three fields in
 * this branch.
 */
export function sumAccountRollups(target: AccountRollup, alias: AccountRollup): AccountRollup {
  return {
    ...target,
    idUnknown: target.idUnknown && alias.idUnknown,
    firstActionAt: Math.min(target.firstActionAt, alias.firstActionAt),
    lastActionAt: Math.max(target.lastActionAt, alias.lastActionAt),
    blockCount: target.blockCount + alias.blockCount,
    muteCount: target.muteCount + alias.muteCount,
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
  const handle = stripAtPrefix(input.handle);

  // We may now have learned a numeric id for an account previously keyed by handle. We
  // keep the existing map key stable (so the store never has to move entries) — only
  // the rollup fields (via applyAccountRollup) and the action history are recomputed.
  const rollup = applyAccountRollup(existing, {
    handle,
    idUnknown: !input.xUserId,
    ...(input.xUserId ? { xUserId: input.xUserId } : {}),
    kind: input.kind,
    at,
  });

  return {
    ...rollup,
    key:
      existing?.key ??
      accountKeyFor({ ...(input.xUserId ? { xUserId: input.xUserId } : {}), handle }),
    actions: existing ? [...existing.actions, action] : [action],
  };
}

/** A rolled-up account snapshot from the cloud — the shape `listBlocked` returns and
 *  `mergeRemote` folds back in. (Re-exported as `RemoteAccount` from blocked-store.) */
export type RemoteAccountSnapshot = {
  xUserId: string;
  handle: string;
  idUnknown: boolean;
  firstActionAt: number;
  lastActionAt: number;
  blockCount: number;
  muteCount: number;
  status: BlockedStatus;
};

/**
 * Fold a remote account snapshot into the matching local record, reconciling two views
 * of the SAME account's already-rolled-up history. This is distinct from
 * `mergeBlockedAccount` (which appends one action, +1) and the cloud's alias fold (which
 * SUMs two distinct rows): both sides here should converge to the same totals, so counts
 * take the max (healing a transiently-behind side without ever double-counting). The
 * id-unknown flag clears once either side knows the id, a real numeric id learned remotely
 * is adopted (but never the "@handle" pseudo-id of a still-handle-keyed remote row), and
 * the side with the newer lastActionAt wins the display handle and status.
 */
export function foldAccountSnapshot(
  local: BlockedAccount,
  row: RemoteAccountSnapshot,
): BlockedAccount {
  const remoteNewer = row.lastActionAt > local.lastActionAt;
  const learnedId = local.xUserId ?? (row.idUnknown ? undefined : row.xUserId);
  return {
    ...local,
    handle: remoteNewer ? row.handle : local.handle,
    idUnknown: local.idUnknown && row.idUnknown,
    ...(learnedId ? { xUserId: learnedId } : {}),
    firstActionAt: Math.min(local.firstActionAt, row.firstActionAt),
    lastActionAt: Math.max(local.lastActionAt, row.lastActionAt),
    blockCount: Math.max(local.blockCount, row.blockCount),
    muteCount: Math.max(local.muteCount, row.muteCount),
    status: remoteNewer ? row.status : local.status,
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
