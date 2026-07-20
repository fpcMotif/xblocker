// Catalog: SC-* (the Spam Classifier — the pure bot-detection verdict for the Bot Sentry).
// Detection is precision-first: any single STRONG rule (escort lexicon, crypto lexicon)
// blocks on its own; the WEAK shape signals (name template, handle shape, throwaway body)
// only block when two or more stack (BLOCK_THRESHOLD). No DOM, no network — plain strings.
import { describe, expect, test } from "bun:test";

import {
  BLOCK_THRESHOLD,
  classify,
  CRYPTO_LEXICON,
  ESCORT_LEXICON,
  type AccountText,
} from "../../entrypoints/content/spam-classifier.ts";

/** A neutral, obviously-human account; individual tests override only what they exercise. */
function account(overrides: Partial<AccountText> = {}): AccountText {
  return {
    displayName: "Jane Doe",
    handle: "janedoe",
    body: "Thanks, this is really helpful!",
    ...overrides,
  };
}

describe("strong escort lexicon", () => {
  test("SC-01 blocks a display name containing 同城约P", () => {
    const verdict = classify(account({ displayName: "小月🍊同城约P🍊点主页" }));
    expect(verdict.block).toBe(true);
    expect(verdict.matched).toContain("escort-strong");
  });

  test("SC-02 blocks 同城上门 / bare 上门 (solicitation vocab, ~zero legit base rate on X)", () => {
    expect(classify(account({ displayName: "翠琴🌸同城上门" })).block).toBe(true);
    expect(classify(account({ displayName: "梦曼🌸上门" })).block).toBe(true);
  });

  test("SC-03 blocks 寻P友", () => {
    expect(classify(account({ displayName: "璐璐🍊寻P友🍊点主页" })).block).toBe(true);
  });

  test("SC-04 blocks 处男免费", () => {
    expect(classify(account({ displayName: "Delia⚡⚡处男免费🌸🌸" })).block).toBe(true);
  });

  test("SC-05 blocks the 点主页 solicitation tell", () => {
    expect(classify(account({ displayName: "小瑞路点主页" })).block).toBe(true);
  });

  test("SC-06 matches a token in the body, not just the name", () => {
    const verdict = classify(account({ displayName: "normal name", body: "加我 约P 详聊" }));
    expect(verdict.block).toBe(true);
    expect(verdict.matched).toContain("escort-strong");
  });

  test("SC-07 matches the latin P euphemism case-insensitively (约p == 约P)", () => {
    expect(classify(account({ displayName: "同城约p" })).block).toBe(true);
  });

  test("SC-08 sees through full-width look-alike evasion (约Ｐ, ｅｔｈ)", () => {
    // Full-width Ｐ (U+FF30) lowercases to full-width ｐ, not ASCII p — NFKC folds it back.
    expect(classify(account({ displayName: "同城约Ｐ" })).block).toBe(true);
    expect(classify(account({ displayName: "gm", body: "ｅｔｈ to the moon" })).block).toBe(true);
  });

  test("SC-09 sees through zero-width-char injection (上<ZWSP>门)", () => {
    expect(classify(account({ displayName: "梦曼🌸上\u200B门" })).block).toBe(true);
  });
});

describe("strong crypto lexicon", () => {
  test("SC-10 blocks a body mentioning ethereum", () => {
    const verdict = classify(account({ displayName: "gm", body: "ethereum to the moon 🚀" }));
    expect(verdict.block).toBe(true);
    expect(verdict.matched).toContain("crypto-strong");
  });

  test("SC-11 blocks a display name containing BTC", () => {
    expect(classify(account({ displayName: "Free BTC giveaway" })).block).toBe(true);
  });

  test("SC-12 blocks a standalone eth / $ETH mention", () => {
    expect(classify(account({ body: "$ETH gang wya" })).block).toBe(true);
  });

  test("SC-13 matches a coin token that appears in the handle", () => {
    const verdict = classify(account({ handle: "bitcoin", displayName: "gm", body: "wagmi" }));
    expect(verdict.matched).toContain("crypto-strong");
  });

  test("SC-14 does NOT flag names/words that merely contain the letters (Seth, together)", () => {
    const verdict = classify(account({ displayName: "Seth", body: "let's do this together" }));
    expect(verdict.matched).not.toContain("crypto-strong");
    expect(verdict.block).toBe(false);
  });

  test("SC-15 does NOT flag 'aesthetic' / 'Kenneth' (eth inside a word)", () => {
    expect(classify(account({ displayName: "Kenneth", body: "love the aesthetic" })).block).toBe(
      false,
    );
  });

  test("SC-16 blocks a hex wallet address in the body", () => {
    const verdict = classify(
      account({ body: "send to 0x1234567890abcdef1234567890abcdef12345678" }),
    );
    expect(verdict.matched).toContain("crypto-strong");
    expect(verdict.block).toBe(true);
  });

  test("SC-17 does NOT treat a short hex (e.g. a CSS color) as a wallet", () => {
    expect(classify(account({ body: "the accent color is 0xFF8800" })).block).toBe(false);
  });
});

describe("weak shape signals require stacking", () => {
  test("SC-20 the name-emoji template alone (one weak signal) does not block", () => {
    const verdict = classify({
      displayName: "北京🌸加油",
      handle: "beijingfan",
      body: "great match tonight",
    });
    expect(verdict.matched).toContain("name-emoji-template");
    expect(verdict.block).toBe(false);
    expect(verdict.score).toBe(1);
  });

  test("SC-21 name template + throwaway body (two weak signals) blocks", () => {
    const verdict = classify({
      displayName: "小月🍊约会🌸点点",
      handle: "cleanuser",
      body: "impressive🌍",
    });
    expect(verdict.matched).toEqual(
      expect.arrayContaining(["name-emoji-template", "throwaway-body"]),
    );
    expect(verdict.block).toBe(true);
  });

  test("SC-22 handle shape (embedded digits) + throwaway body blocks", () => {
    const verdict = classify({
      displayName: "hello there",
      handle: "sandra15xf4",
      body: "hilarious🍣",
    });
    expect(verdict.matched).toEqual(expect.arrayContaining(["handle-shape", "throwaway-body"]));
    expect(verdict.block).toBe(true);
  });

  test("SC-23 handle shape via a consonant cluster (no digits) is detected", () => {
    const verdict = classify(account({ handle: "MarisolVanfmf" }));
    expect(verdict.matched).toContain("handle-shape");
  });

  test("SC-24 a short handle cannot match the handle-shape rule", () => {
    expect(classify(account({ handle: "abc" })).matched).not.toContain("handle-shape");
  });

  test("SC-25 an emoji-only body is a throwaway signal", () => {
    const verdict = classify(account({ handle: "abc", body: "😊" }));
    expect(verdict.matched).toContain("throwaway-body");
    expect(verdict.block).toBe(false);
  });
});

describe("precision — genuine accounts are never blocked", () => {
  test("SC-30 an ordinary account scores zero", () => {
    const verdict = classify(account());
    expect(verdict.block).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.matched).toEqual([]);
  });

  test("SC-31 empty inputs are inert", () => {
    const verdict = classify({ displayName: "", handle: "", body: "" });
    expect(verdict).toEqual({ block: false, score: 0, matched: [] });
  });

  test("SC-32 a real enthusiastic reply with an emoji is not a throwaway body", () => {
    const verdict = classify(account({ handle: "abc", body: "impressive work 🔥" }));
    expect(verdict.matched).not.toContain("throwaway-body");
  });

  test("SC-33 上门 in a reply body blocks on X (solicitation vocab, not a repair listing)", () => {
    // On X there is no legitimate 上门维修 business context (that lives on 58同城/WeChat), so
    // the near-zero-base-rate 上门 token is treated as strong here. The rare home-repair /
    // 上门女婿-meme false positive is an accepted, documented cost on this platform.
    const verdict = classify({
      displayName: "老王家电维修",
      handle: "wanghomerepair",
      body: "同城上门维修，需要的私信",
    });
    expect(verdict.block).toBe(true);
  });

  test("SC-34 外围 (peripherals) is the lone carve-out — a tech reply does not block", () => {
    // X's Chinese tech community genuinely discusses 外围设备 (computer peripherals), so 外围
    // is deliberately kept OUT of the auto-block lexicon.
    const verdict = classify({
      displayName: "键盘老王",
      handle: "keebfan",
      body: "这个外围设备用起来很顺手，推荐",
    });
    expect(verdict.block).toBe(false);
  });

  test("SC-36 the 加微/加V off-platform contact-handoff blocks", () => {
    expect(classify(account({ displayName: "normal", body: "详情加微信 详聊" })).block).toBe(true);
    expect(classify(account({ body: "加V看主页" })).block).toBe(true);
  });

  test("SC-35 an ordinary birth-year handle trips only the weak signal, never a block", () => {
    // handle-shape is deliberately loose (a letter+digit handle like a birth year fires it),
    // but it is WEAK: on its own, with a normal name and reply, it can never reach the bar.
    const verdict = classify({
      displayName: "John Baker",
      handle: "john1985",
      body: "totally agree with this take",
    });
    expect(verdict.matched).toEqual(["handle-shape"]);
    expect(verdict.block).toBe(false);
    expect(verdict.score).toBe(1);
  });
});

describe("real screenshot bots (display + handle + body together)", () => {
  const bots: Array<[string, AccountText]> = [
    [
      "璐璐/samantha94qv0",
      { displayName: "璐璐🍊寻P友🍊点主页", handle: "samantha94qv0", body: "🦋クリーン🦂" },
    ],
    [
      "翠琴/LavonneChajxui",
      { displayName: "翠琴🌸同城上门", handle: "LavonneChajxui", body: "🚴" },
    ],
    ["梦曼/VanForero", { displayName: "梦曼🌸同城上门", handle: "VanForero", body: "🚶" }],
    [
      "小月/sandra15xf4",
      { displayName: "小月🍊同城约P🍊点主页", handle: "sandra15xf4", body: "impressive🌍" },
    ],
    [
      "Delia/MonnieBosqsc24",
      { displayName: "Delia⚡⚡处男免费🌸🌸", handle: "MonnieBosqsc24", body: "😊" },
    ],
    ["书柏/MarisolVanfmf", { displayName: "书柏🌸同城上门", handle: "MarisolVanfmf", body: "🍩" }],
  ];

  for (const [name, input] of bots) {
    test(`SC-40 blocks ${name}`, () => {
      expect(classify(input).block).toBe(true);
    });
  }
});

describe("rule catalog is exported and extensible", () => {
  test("SC-50 the lexicons are non-empty arrays of tokens", () => {
    expect(ESCORT_LEXICON.length).toBeGreaterThan(0);
    expect(CRYPTO_LEXICON).toContain("bitcoin");
  });

  test("SC-51 BLOCK_THRESHOLD is the documented two-weak-signal bar", () => {
    expect(BLOCK_THRESHOLD).toBe(2);
  });
});
