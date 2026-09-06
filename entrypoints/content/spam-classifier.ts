// The Spam Classifier: the Bot Sentry's pure detection brain. Given an account's text
// (display name, handle, reply body) it returns a verdict — whether to treat the account as
// a spam bot, a numeric score, and which rules fired. No DOM, no network, no storage: the
// same inputs always yield the same verdict, so precision/recall can be pinned by plain-string
// table tests (test/content/spam-classifier.test.ts) without a browser.
//
// Detection is PRECISION-FIRST, because the Bot Sentry auto-blocks (a hard-to-reverse act)
// site-wide when the autoBlockSpam setting is on (off by default — see
// entrypoints/content/auto-block.ts). Two tiers:
//   - STRONG rules — the escort/solicitation lexicon and the crypto-shill lexicon — are each
//     sufficient on their own: those tokens essentially never occur in a genuine name/body.
//   - WEAK shape signals — the emoji-separated CJK name template, the random-looking handle,
//     the adjective-plus-emoji throwaway body — are individually ambiguous (real handles and
//     real short replies can look similar), so they only block when ALL THREE stack (see
//     BLOCK_THRESHOLD's comment — any two alone, e.g. a birth-year handle plus a one-word
//     reply, matches too many genuine accounts to trust).
export type AccountText = {
  displayName: string;
  handle: string;
  body: string;
};

export type RuleId =
  | "escort-strong"
  | "crypto-strong"
  | "name-emoji-template"
  | "handle-shape"
  | "throwaway-body";

export type Verdict = {
  block: boolean;
  score: number;
  matched: RuleId[];
};

// A lone STRONG rule reaches the bar on its own (STRONG_WEIGHT == BLOCK_THRESHOLD). The WEAK
// tier has exactly three rules (name-emoji-template, handle-shape, throwaway-body); each is
// individually common enough in genuine accounts that any two of them can coincide by chance
// (a birth-year handle like "dave1979" plus an ordinary short reply like "congrats 🎉" trips
// both handle-shape and throwaway-body). Requiring all three (WEAK_WEIGHT * 3 == BLOCK_THRESHOLD)
// keeps the weak-only path a rare, conservative net rather than a second easily-tripped
// solo-block route — every real bot this classifier was calibrated against (see the SC-40
// fixtures) is already caught by a STRONG lexicon hit, so the weak tier never had to carry
// detection weight on its own.
export const BLOCK_THRESHOLD = 3;
const STRONG_WEIGHT = 3;
const WEAK_WEIGHT = 1;

// Escort/solicitation + adjacent bait lexicon (STRONG). PLATFORM CONTEXT is the calibration:
// this runs on X, not a Chinese local-services app (58同城 / 美团) or WeChat. Legitimate
// outcall/home-visit businesses and personal contact-handoff live on those platforms, not
// here, so on X the solicitation vocabulary — 上门 ("outcall"), and the 加微/加V family ("add
// my WeChat", i.e. take this off-platform) — has a near-zero legitimate base rate and is
// treated as STRONG. (The residual 上门维修 / 上门女婿-meme body is negligible on X.) The LONE
// holdout is 外围 ("periphery", 外围设备 = "peripherals"): X's active Chinese tech community
// genuinely says it, so 外围 stays out of auto-block. Also carries the OF-bait/thirst-trap
// copy-paste templates and the 互fo mutual-follow-bait marker (see the entries below), which
// share the same near-zero legitimate base rate even though they aren't escort vocabulary
// per se. Stored lower-cased so the latin euphemisms (约P / 4P / 加V) match case-insensitively.
export const ESCORT_LEXICON: readonly string[] = [
  "约p",
  "约炮",
  "寻p友",
  "p友",
  "4p",
  "3p",
  "处男免费",
  "点主页",
  "点主頁",
  "看主页",
  "上门",
  "加微",
  "加v",
  "加薇",
  "加威",
  // OF-bait / thirst-trap templates (added 2026-08-01 from a live copy-pasted spam wave —
  // the same two sentences, verbatim, across a dozen freshly-created accounts). Each is a
  // multi-character phrase fragment, not a single ambiguous word, so the collision risk is
  // the same as the rest of this tier: essentially zero outside the bait context.
  "锐评一下我的福",
  "我福不黑不信你看",
  "比我骚的没我好看",
  "比我好看的没我骚",
  // Mutual-follow-exchange bait ("互fo" = 互相关注/follow each other, common in bio-swap
  // bot networks). Distinct from the escort vocabulary above but shares its near-zero
  // legitimate base rate on X, so it lives in the same STRONG tier.
  "互fo",
];

// Crypto-shill lexicon (STRONG). Matched on word/token boundaries so an ordinary word that
// merely contains these letters ("Seth", "Kenneth", "aesthetic", "together") is never flagged.
// Only unambiguous coin names live here. The wider crypto vocabulary listed elsewhere — cashtags
// ($DOGE), 空投/airdrop, 钱包/提现/代币 — is deliberately EXCLUDED from this auto-block tier:
// each collides with a legitimate meaning ($AAPL is a stock ticker, 空投 is a PUBG supply drop,
// airdrop is an Apple feature, 钱包/提现 are ordinary banking words), so as solo block triggers
// they would cost precision. They belong in a future weak-signal tier, not here.
export const CRYPTO_LEXICON: readonly string[] = [
  "bitcoin",
  "ethereum",
  "eth",
  "btc",
  "usdt",
  "bnb",
];

const CRYPTO_PATTERN = new RegExp(String.raw`\b(?:${CRYPTO_LEXICON.join("|")})\b`, "i");

// Even \b-bounded, "eth" and "bnb" alone are real acronyms outside crypto (ETH Zürich the
// university; air-bnb/Airbnb) — a bare boundary match can't tell those apart from the coin
// ticker. Strip the two documented collision phrases before the lexicon test runs, rather
// than trying to teach the boundary regex context it can't express.
const CRYPTO_ACRONYM_CARVEOUTS = /\bair[\s-]?bnb\b|\beth\s*z[uü]rich\b/gi;

// A hex wallet address (0x + 30..64 hex) IS unambiguous — no legit reply carries one — so it
// stays in the STRONG tier. The 30-char floor clears short hex like CSS colors (0xFFFFFF).
const WALLET_PATTERN = /0x[a-f0-9]{30,64}\b/i;

// The "name🍊keyword🌸keyword" template: a pictographic emoji sitting between two Han runs.
// WEAK on its own — a real 北京🇨🇳加油 fits it too.
const NAME_TEMPLATE_PATTERN =
  /\p{Script=Han}[^\p{Script=Han}]*\p{Extended_Pictographic}[^\p{Script=Han}]*\p{Script=Han}/u;

// A run of four+ consonants — the "gibberish tail" of a generated handle (Vanfmf, Antvj).
const CONSONANT_CLUSTER_PATTERN = /[bcdfghjklmnpqrstvwxz]{4,}/i;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

// Bots defeat a naive substring/word match by full-width look-alikes (约Ｐ, ｅｔｈ — JS
// lowercases full-width Ｐ to full-width ｐ, never ASCII p) and by injecting zero-width /
// format chars between characters (上<ZWSP>门). Fold both away before the STRONG lexicon
// runs: strip zero-width joiners/spaces/BOM, then NFKC-normalize full-width & compatibility
// forms to ASCII. (Verified: without this, 约Ｐ / ｅｔｈ / 上<ZWSP>门 all pass silently.)
function normalizeForMatch(text: string): string {
  return text.replace(/​|‌|‍|⁠|﻿/g, "").normalize("NFKC");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Most escort tokens are unambiguous Chinese solicitation phrases with no known collision, so
// a plain (escaped) substring match is enough. Three tokens need more care — each has a
// documented, evidenced false-positive collision (see spam-classifier.test.ts's SC-6x
// regression cases) that a bare substring/boundary match cannot avoid on its own:
//   - "4p"/"3p" collide with ordinary time/measurement text (4pm, 3pm, 4px, 144p) under plain
//     substring matching -- \b-bounding them (rather than the lexicon's shared plain-includes
//     path) excludes all four, since "m"/"x"/a digit are word characters with no boundary
//     against a trailing "p".
//   - "上门" collides with 晚上门口 ("evening doorway") / 早上门店 ("morning storefront"), two
//     ordinary time-of-day compounds that merely contain it as a substring -- excluded via a
//     negative lookbehind on the two documented prefixes that produce them.
//   - "加微" collides with 更加微妙 / 参加微博 / 稍加微调 ("even more subtle" / "join Weibo" /
//     "slightly adjust"), where 加 means "more"/"join"/"slightly", not the imperative "add" --
//     excluded via a negative lookbehind on the three documented prefixes.
function escortPatternFor(token: string): RegExp {
  switch (token) {
    case "4p":
    case "3p":
      return new RegExp(String.raw`\b${token}\b`);
    case "上门":
      return /(?<![晚早])上门/;
    case "加微":
      return /(?<![更参稍])加微/;
    default:
      return new RegExp(escapeRegExp(token));
  }
}

const ESCORT_RULES: ReadonlyArray<{ token: string; pattern: RegExp }> = ESCORT_LEXICON.map(
  (token) => ({ token, pattern: escortPatternFor(token) }),
);

function hasEscortToken(haystack: string): boolean {
  const lower = normalizeForMatch(haystack).toLowerCase();
  return ESCORT_RULES.some((rule) => rule.pattern.test(lower));
}

function hasCryptoToken(haystack: string): boolean {
  const normalized = normalizeForMatch(haystack).replace(CRYPTO_ACRONYM_CARVEOUTS, " ");
  return CRYPTO_PATTERN.test(normalized) || WALLET_PATTERN.test(normalized);
}

function hasNameTemplate(displayName: string): boolean {
  return NAME_TEMPLATE_PATTERN.test(displayName);
}

// Deliberately loose and WEAK-only: it fires on some ordinary handles too (a common handle
// can carry a consonant cluster), which is why it can never block without the other two
// weak signals also stacking (see BLOCK_THRESHOLD).
function hasHandleShape(handle: string): boolean {
  const bare = handle.replace(/^@/, "");
  if (bare.length < 6) {
    return false;
  }
  const nameDigitMix = /[a-z]/i.test(bare) && /\d/.test(bare);
  return nameDigitMix || CONSONANT_CLUSTER_PATTERN.test(bare);
}

// The throwaway reply shape: an emoji-only body, or a single short word plus emoji
// ("hilarious🍣", "impressive🌍"). A real short reply with several words ("impressive work 🔥")
// is NOT throwaway, which is what keeps this from firing on genuine enthusiasm.
function hasThrowawayBody(body: string): boolean {
  const trimmed = body.trim();
  if (!EMOJI_PATTERN.test(trimmed)) {
    return false;
  }
  // Strip emoji, then everything that is not a letter or number (punctuation, symbols,
  // whitespace, and emoji joiners/variation selectors) collapses to spaces.
  const textOnly = trimmed
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (textOnly === "") {
    return true;
  }
  return !/\s/.test(textOnly) && textOnly.length <= 16;
}

export function classify(input: AccountText): Verdict {
  const { displayName, handle, body } = input;
  const nameAndBody = `${displayName} ${body}`;
  const allText = `${displayName} ${handle} ${body}`;

  // Each tier is (rules, per-hit weight); one shared fold keeps strong and weak from
  // drifting apart. Strong rules come first so `matched` reads strong-before-weak.
  const tiers: Array<[Array<[RuleId, boolean]>, number]> = [
    [
      [
        ["escort-strong", hasEscortToken(nameAndBody)],
        ["crypto-strong", hasCryptoToken(allText)],
      ],
      STRONG_WEIGHT,
    ],
    [
      [
        ["name-emoji-template", hasNameTemplate(displayName)],
        ["handle-shape", hasHandleShape(handle)],
        ["throwaway-body", hasThrowawayBody(body)],
      ],
      WEAK_WEIGHT,
    ],
  ];

  const matched: RuleId[] = [];
  let score = 0;
  for (const [rules, weight] of tiers) {
    for (const [id, hit] of rules) {
      if (hit) {
        matched.push(id);
        score += weight;
      }
    }
  }

  return { block: score >= BLOCK_THRESHOLD, score, matched };
}
