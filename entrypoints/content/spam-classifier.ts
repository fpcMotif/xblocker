// The Spam Classifier: the Bot Sentry's pure detection brain. Given an account's text
// (display name, handle, reply body) it returns a verdict — whether to treat the account as
// a spam bot, a numeric score, and which rules fired. No DOM, no network, no storage: the
// same inputs always yield the same verdict, so precision/recall can be pinned by plain-string
// table tests (test/content/spam-classifier.test.ts) without a browser.
//
// Detection is PRECISION-FIRST, because the Bot Sentry auto-blocks (a hard-to-reverse act)
// site-wide and on by default (see #25; the auto-block decision is recorded by the ADR in #30).
// Two tiers:
//   - STRONG rules — the escort/solicitation lexicon and the crypto-shill lexicon — are each
//     sufficient on their own: those tokens essentially never occur in a genuine name/body.
//   - WEAK shape signals — the emoji-separated CJK name template, the random-looking handle,
//     the adjective-plus-emoji throwaway body — are individually ambiguous (real handles and
//     real short replies can look similar), so they only block when two or more STACK.
// The stacking bar (BLOCK_THRESHOLD) is the feature's tunable precision knob.

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

// One STRONG rule reaches the bar on its own (STRONG_WEIGHT == BLOCK_THRESHOLD); a single
// WEAK signal (WEAK_WEIGHT == 1) does not, so two must stack. Raising BLOCK_THRESHOLD makes
// the weak-only path stricter without touching the strong lexicons.
export const BLOCK_THRESHOLD = 2;
const STRONG_WEIGHT = 2;
const WEAK_WEIGHT = 1;

// Escort / solicitation lexicon (STRONG). PLATFORM CONTEXT is the calibration: this runs on
// X, not a Chinese local-services app (58同城 / 美团) or WeChat. Legitimate outcall/home-visit
// businesses and personal contact-handoff live on those platforms, not here, so on X the
// solicitation vocabulary — 上门 ("outcall"), and the 加微/加V family ("add my WeChat", i.e.
// take this off-platform) — has a near-zero legitimate base rate and is treated as STRONG.
// (The residual 上门维修 / 上门女婿-meme body is negligible on X.) The LONE holdout is 外围
// ("periphery", 外围设备 = "peripherals"): X's active Chinese tech community genuinely says it,
// so 外围 stays out of auto-block. Stored lower-cased so the latin euphemisms (约P / 4P / 加V)
// match case-insensitively.
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
];

// Crypto-shill lexicon (STRONG). Matched on word/token boundaries so an ordinary word that
// merely contains these letters ("Seth", "Kenneth", "aesthetic", "together") is never flagged.
// Only unambiguous coin names live here. The wider crypto vocabulary #25 listed — cashtags
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

function hasEscortToken(haystack: string): boolean {
  const lower = haystack.toLowerCase();
  return ESCORT_LEXICON.some((token) => lower.includes(token));
}

function hasCryptoToken(haystack: string): boolean {
  return CRYPTO_PATTERN.test(haystack) || WALLET_PATTERN.test(haystack);
}

function hasNameTemplate(displayName: string): boolean {
  return NAME_TEMPLATE_PATTERN.test(displayName);
}

// Deliberately loose and WEAK-only: it fires on some ordinary handles too (a common handle
// can carry a consonant cluster), which is why it can never block without a second signal.
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
