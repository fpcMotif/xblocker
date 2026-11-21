// Deterministic storage payloads for the extension pages: an empty install, a typical
// one, and a worst case (widest legal handles, five-digit counts, a failed sync).

const NOW = Date.UTC(2026, 10, 16, 4, 0, 0);
const MINUTE = 60_000;

type Seed = Record<string, unknown>;

const WIDE_HANDLES = [
  "WWWWWWWWWWWWWWW",
  "MMMMMMMMMMMMMMM",
  "x",
  "_",
  "tanaka_taro_jp",
  "a_b_c_d_e_f_g_h",
];

function account(index: number, handle: string, kind: "block" | "mute") {
  const at = NOW - index * 7 * MINUTE;
  return {
    key: `@${handle.toLowerCase()}`,
    handle,
    idUnknown: true,
    firstActionAt: at,
    lastActionAt: at,
    blockCount: kind === "block" ? 1 : 0,
    muteCount: kind === "mute" ? 1 : 0,
    status: "active",
    actions: [{ actionId: `a-${index}`, kind, at, source: index % 9 === 0 ? "auto" : "reply-bar" }],
  };
}

function accounts(count: number): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    const handle = WIDE_HANDLES[index] ?? `acct_${String(index).padStart(6, "0")}`;
    const entry = account(index, handle, index % 4 === 3 ? "mute" : "block");
    map[entry.key] = entry;
  }
  return map;
}

export const EMPTY: Seed = {};

export const TYPICAL: Seed = {
  blockedAccounts: accounts(128),
  whitelist: ["ada", "grace_hopper", "linus"],
  cloudBackup: false,
};

export const WORST: Seed = {
  blockedAccounts: accounts(24_680),
  whitelist: [...WIDE_HANDLES, ...Array.from({ length: 400 }, (_, index) => `friend_${index}`)],
  cloudBackup: true,
};

export const SEEDS = { empty: EMPTY, typical: TYPICAL, worst: WORST } as const;
export const SEED_NAMES = ["empty", "typical", "worst"] as const;
