// Catalog: SC-* (the Spam Classifier — the pure bot-detection verdict for the Bot Sentry).
// Detection is precision-first: any single STRONG rule (escort lexicon, crypto lexicon)
// blocks on its own; the WEAK shape signals (name template, handle shape, throwaway body)
// only block when ALL THREE stack (BLOCK_THRESHOLD) — see spam-classifier.ts's comment on
// why two is not enough. No DOM, no network — plain strings.
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
    expect(
      classify(account({ displayName: "gm", body: "ｅｔｈｅｒｅｕｍ to the moon" })).block,
    ).toBe(true);
  });

  test("SC-09 sees through zero-width-char injection (上<ZWSP>门)", () => {
    expect(classify(account({ displayName: "梦曼🌸上​门" })).block).toBe(true);
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

  test("SC-18 does NOT flag 'ETH Zurich' (the university, not the coin ticker)", () => {
    const verdict = classify(account({ displayName: "gm", body: "I studied at ETH Zurich" }));
    expect(verdict.matched).not.toContain("crypto-strong");
  });

  test("SC-19 does NOT flag 'air-bnb' / 'airbnb' (the acronym, not the coin ticker)", () => {
    expect(
      classify(account({ displayName: "gm", body: "just booked an air-bnb" })).matched,
    ).not.toContain("crypto-strong");
    expect(
      classify(account({ displayName: "gm", body: "airbnb host tips?" })).matched,
    ).not.toContain("crypto-strong");
  });
});

describe("weak shape signals require all three to stack", () => {
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

  test("SC-21 name template + throwaway body (only two weak signals) does not block", () => {
    const verdict = classify({
      displayName: "小月🍊约会🌸点点",
      handle: "cleanuser",
      body: "impressive🌍",
    });
    expect(verdict.matched).toEqual(
      expect.arrayContaining(["name-emoji-template", "throwaway-body"]),
    );
    expect(verdict.block).toBe(false);
    expect(verdict.score).toBe(2);
  });

  test("SC-22 handle shape (embedded digits) + throwaway body (only two weak signals) does not block", () => {
    const verdict = classify({
      displayName: "hello there",
      handle: "sandra15xf4",
      body: "hilarious🍣",
    });
    expect(verdict.matched).toEqual(expect.arrayContaining(["handle-shape", "throwaway-body"]));
    expect(verdict.block).toBe(false);
  });

  test("SC-22b all three weak signals stacking DOES block", () => {
    const verdict = classify({
      displayName: "小月🍊约会🌸点点",
      handle: "sandra15xf4",
      body: "hilarious🍣",
    });
    expect(verdict.matched).toEqual(
      expect.arrayContaining(["name-emoji-template", "handle-shape", "throwaway-body"]),
    );
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

  test("SC-26 an ordinary birth-year handle replying with a throwaway emoji reply never blocks (regression: was a false positive under the old 2-signal bar)", () => {
    // dave1979 is shaped identically to a real bot fixture (letters+digits handle, one-word
    // + emoji reply) but is an ordinary account -- the classifier cannot and should not tell
    // them apart on shape alone, so the bar requires the (much rarer) third signal too.
    const verdict = classify({ displayName: "Dave", handle: "dave1979", body: "congrats 🎉" });
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

  test("SC-35 the 加微/加V off-platform contact-handoff blocks", () => {
    expect(classify(account({ displayName: "normal", body: "详情加微信 详聊" })).block).toBe(true);
    expect(classify(account({ body: "加V看主页" })).block).toBe(true);
  });

  test("SC-37 互fo mutual-follow bait blocks even with no other signal", () => {
    expect(
      classify({ displayName: "习狗腿🐶加速（互fo🇨🇳🇺🇸)", handle: "LiberalNewWorld", body: "" })
        .block,
    ).toBe(true);
  });

  test("SC-38 two national flags in a name, with no other signal, does NOT block", () => {
    // Flags alone are far too common on genuine bilingual/expat accounts to carry weight;
    // 互fo (SC-37) is the actual precise tell, not the flags.
    const verdict = classify({
      displayName: "Jane 🇨🇳🇺🇸 living abroad",
      handle: "janedoe",
      body: "excited to be here",
    });
    expect(verdict.block).toBe(false);
    expect(verdict.score).toBe(0);
  });

  test("SC-39 does NOT flag unrelated uses of 涩/骚/锐评 in ordinary sentences", () => {
    expect(
      classify({
        displayName: "gm",
        handle: "foodie123",
        body: "这个柿子太涩了，帮忙锐评一下我的画技",
      }).matched,
    ).not.toContain("escort-strong");
    expect(
      classify({ displayName: "gm", handle: "coder123", body: "这个骚操作太好看了，学到了" })
        .matched,
    ).not.toContain("escort-strong");
  });

  test("SC-36 an ordinary birth-year handle trips only the weak signal, never a block", () => {
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

describe("regression — documented false positives (empirically found 2026-08-01)", () => {
  test("SC-60 does NOT block ordinary '4pm'/'3pm' time mentions", () => {
    expect(classify(account({ body: "let's call it 4pm" })).matched).not.toContain("escort-strong");
    expect(classify(account({ body: "back by 3pm" })).matched).not.toContain("escort-strong");
  });

  test("SC-61 does NOT block ordinary '4px'/'144p' measurement mentions", () => {
    expect(classify(account({ body: "border-radius: 4px" })).matched).not.toContain(
      "escort-strong",
    );
    expect(classify(account({ body: "this stream is only 144p" })).matched).not.toContain(
      "escort-strong",
    );
  });

  test("SC-62 does NOT block 晚上门口 / 早上门店 (ordinary time-of-day compounds containing 上门)", () => {
    expect(
      classify({ displayName: "老王", handle: "wanghome", body: "晚上门口见面吧" }).matched,
    ).not.toContain("escort-strong");
    expect(
      classify({ displayName: "老王", handle: "wanghome", body: "早上门店刚开门" }).matched,
    ).not.toContain("escort-strong");
  });

  test("SC-63 does NOT block 更加微妙/参加微博/稍加微调 (ordinary compounds containing 加微)", () => {
    for (const body of ["这件事更加微妙了", "打算参加微博的活动", "稍加微调就能用"]) {
      expect(classify({ displayName: "gm", handle: "abc123", body }).matched).not.toContain(
        "escort-strong",
      );
    }
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

// A second, later-observed real spam wave (2026-08-01): a dozen freshly-created accounts
// posting one of two exact copy-pasted OF-bait/thirst-trap sentences as replies, plus one
// follow-exchange-bait account. Captured verbatim off a live x.com reply thread.
describe("real spam wave — OF-bait templates + follow-exchange bait (2026-08-01)", () => {
  const bots: Array<[string, AccountText]> = [
    [
      "雪绿/AnnWattpmeo",
      {
        displayName: "雪绿🌸",
        handle: "AnnWattpmeo",
        body: "比我好看的没我骚🚲⏳比我骚的没我好看",
      },
    ],
    [
      "易梦/AngelaRolay2uu",
      {
        displayName: "易梦🌸",
        handle: "AngelaRolay2uu",
        body: "我果然太涩了🤟❤️有人想锐评一下我的福嘛",
      },
    ],
    [
      "灵薇/BerthaIsaako0y",
      {
        displayName: "灵薇🌸",
        handle: "BerthaIsaako0y",
        body: "我果然太涩了🦅💯有人想锐评一下我的福嘛",
      },
    ],
    [
      "听筠/EudoraMaggbhoi",
      {
        displayName: "听筠",
        handle: "EudoraMaggbhoi",
        body: "应该没人比我玩的开了吧💎🧀 我福不黑不信你看",
      },
    ],
    [
      "翠柔/MollyHawth7b4p",
      {
        displayName: "翠柔",
        handle: "MollyHawth7b4p",
        body: "应该没人比我玩的开了吧🥹🍇 我福不黑不信你看",
      },
    ],
    [
      "惜海/LorraineDeibmc",
      {
        displayName: "惜海",
        handle: "LorraineDeibmc",
        body: "应该没人比我玩的开了吧🤽⭐ 我福不黑不信你看",
      },
    ],
    [
      "觅荷/MollyDouglduzj",
      {
        displayName: "觅荷",
        handle: "MollyDouglduzj",
        body: "应该没人比我玩的开了吧👆🏆 我福不黑不信你看",
      },
    ],
    [
      "绿春/VanessaBet9uwr",
      {
        displayName: "绿春",
        handle: "VanessaBet9uwr",
        body: "应该没人比我玩的开了吧🤝🌯 我福不黑不信你看",
      },
    ],
    [
      "若萱/ErnestSele11231",
      {
        displayName: "若萱🌸",
        handle: "ErnestSele11231",
        body: "我果然太涩了⛹️🌟有人想锐评一下我的福嘛",
      },
    ],
    [
      "听菡/TrudaM57795",
      {
        displayName: "听菡🌸",
        handle: "TrudaM57795",
        body: "应该没人比我玩的开了吧🥦⛵ 我福不黑不信你看",
      },
    ],
    [
      "代云/quintina75105",
      {
        displayName: "代云🌸",
        handle: "quintina75105",
        body: "应该没人比我玩的开了吧🍌📱 我福不黑不信你看",
      },
    ],
    [
      "诗翠/JocelynLeombol",
      {
        displayName: "诗翠🌸",
        handle: "JocelynLeombol",
        body: "我果然太涩了🚶🪴有人想锐评一下我的福嘛",
      },
    ],
    [
      "诗霜/SallyChaucftrr",
      {
        displayName: "诗霜🌸",
        handle: "SallyChaucftrr",
        body: "应该没人比我玩的开了吧🐣🍃 我福不黑不信你看",
      },
    ],
    [
      "习狗腿/LiberalNewWorld",
      { displayName: "习狗腿🐶加速（互fo🇨🇳🇺🇸)", handle: "LiberalNewWorld", body: "" },
    ],
  ];

  for (const [name, input] of bots) {
    test(`SC-70 blocks ${name}`, () => {
      expect(classify(input).block).toBe(true);
    });
  }
});

describe("rule catalog is exported and extensible", () => {
  test("SC-50 the lexicons are non-empty arrays of tokens", () => {
    expect(ESCORT_LEXICON.length).toBeGreaterThan(0);
    expect(CRYPTO_LEXICON).toContain("bitcoin");
  });

  test("SC-51 BLOCK_THRESHOLD is the documented three-weak-signal bar", () => {
    expect(BLOCK_THRESHOLD).toBe(3);
  });
});
