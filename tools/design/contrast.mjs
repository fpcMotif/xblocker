// APCA + gamut audit of the Calm Control tokens. Reads the canonical token strings from
// entrypoints/lib/design-tokens.ts, composites alpha colors over their backdrop, and fails
// when a pair falls under its Lc target or a token leaves the sRGB gamut.
import { APCAcontrast, sRGBtoY } from "apca-w3";
import { converter, inGamut, parse } from "culori";

import {
  XB_DARK_TOKENS,
  XB_LIGHT_TOKENS,
  XB_TONE_TOKENS,
} from "../../entrypoints/lib/design-tokens.ts";

const toRgb = converter("rgb");
const inSrgb = inGamut("rgb");
const WHITE = "oklch(1 0 0)";

// Lc targets: 75 body text, 60 secondary text and button labels, 45 icons and large
// glyphs, 30 focus rings and status dots, 9 hairline borders. A hairline is never the only
// edge cue (every bordered surface also carries a shadow ring or a fill step), so it sits
// under APCA's Lc 15 floor for standalone non-text on purpose.
const BODY = 75;
const SECONDARY = 60;
const ICON = 45;
const RING = 30;
const HAIRLINE = 9;

/** [foreground, background, Lc target, where it is used] */
const THEMED_PAIRS = [
  ["--xb-ink", "--xb-surface", BODY, "body text"],
  ["--xb-ink", "--xb-elevated", BODY, "body text on cards"],
  ["--xb-ink", "--xb-track", BODY, "secondary button label"],
  ["--xb-ink-muted", "--xb-surface", SECONDARY, "descriptions"],
  ["--xb-ink-muted", "--xb-elevated", SECONDARY, "descriptions on cards"],
  ["--xb-ink-muted", "--xb-track", SECONDARY, "count chip, input prefix"],
  ["--xb-primary-text", "--xb-surface", SECONDARY, "links"],
  ["--xb-primary-text", "--xb-elevated", SECONDARY, "links on cards"],
  ["--xb-hero-ink", "--xb-hero-bg", BODY, "toast text"],
  ["--xb-danger-text", "--xb-surface", SECONDARY, "error text and icons"],
  ["--xb-danger-text", "--xb-elevated", SECONDARY, "error text on cards"],
  ["--xb-success-text", "--xb-surface", SECONDARY, "success text and icons"],
  [WHITE, "--xb-primary-btn-bg", SECONDARY, "primary button label"],
  [WHITE, "--xb-danger-btn-bg", SECONDARY, "danger button label"],
  [WHITE, "--xb-success-btn-bg", SECONDARY, "confirm button label"],
  [WHITE, "--xb-primary", ICON, "puck icon"],
  [WHITE, "--xb-danger-btn-bg", BODY, "puck count, 10px"],
  ["--xb-success", "--xb-surface", RING, "status dot"],
  ["--xb-danger", "--xb-surface", RING, "status dot"],
  ["--xb-warning", "--xb-surface", RING, "status dot"],
  ["--xb-primary", "--xb-surface", RING, "focus ring"],
  ["--xb-primary", "--xb-hero-bg", RING, "focus ring on toast"],
  ["--xb-success", "--xb-hero-bg", RING, "toast dot"],
  ["--xb-warning", "--xb-hero-bg", RING, "toast dot"],
  ["--xb-border", "--xb-surface", HAIRLINE, "hairline border"],
  ["--xb-border", "--xb-elevated", HAIRLINE, "hairline border on cards"],
];

function declarations(block) {
  return Object.fromEntries(
    Array.from(block.matchAll(/(--xb-[a-z-]+):\s*([^;]+);/g), (match) => [match[1], match[2]]),
  );
}

function resolve(tokens, nameOrColor) {
  const value = nameOrColor.startsWith("--") ? tokens[nameOrColor] : nameOrColor;
  const color = value === undefined ? undefined : parse(value);
  if (!color) {
    throw new Error(`Cannot resolve ${nameOrColor}`);
  }
  return color;
}

/** Composite a possibly translucent color over an opaque backdrop, in sRGB like CSS does. */
function over(color, backdrop) {
  const top = toRgb(color);
  const bottom = toRgb(backdrop);
  const alpha = top.alpha ?? 1;
  const mix = (a, b) => a * alpha + b * (1 - alpha);
  return { mode: "rgb", r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) };
}

function luminance(color) {
  const channel = (value) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return sRGBtoY([channel(color.r), channel(color.g), channel(color.b)]);
}

function audit(themeName, tokens) {
  const surface = toRgb(resolve(tokens, "--xb-surface"));
  const rows = [];
  for (const [fg, bg, target, use] of THEMED_PAIRS) {
    const backdrop = over(resolve(tokens, bg), surface);
    const ink = over(resolve(tokens, fg), backdrop);
    const lc = Math.abs(Number(APCAcontrast(luminance(ink), luminance(backdrop))));
    rows.push({ theme: themeName, fg, bg, use, target, lc: Math.round(lc * 10) / 10, pass: lc >= target });
  }
  return rows;
}

function gamutFailures(themeName, tokens) {
  return Object.entries(tokens)
    .filter(([name]) => name !== "--xb-shadow" && !name.startsWith("--xb-ease"))
    .filter(([, value]) => !inSrgb(parse(value)))
    .map(([name, value]) => `${themeName} ${name}: ${value} is outside sRGB`);
}

const tone = declarations(XB_TONE_TOKENS);
const themes = {
  dark: { ...tone, ...declarations(XB_DARK_TOKENS) },
  light: { ...tone, ...declarations(XB_LIGHT_TOKENS) },
};

const rows = Object.entries(themes).flatMap(([name, tokens]) => audit(name, tokens));
const clipped = Object.entries(themes).flatMap(([name, tokens]) => gamutFailures(name, tokens));
const failed = rows.filter((row) => !row.pass);

const shown = process.argv.includes("--all") ? rows : failed;
for (const row of shown) {
  const mark = row.pass ? "ok  " : "FAIL";
  console.log(
    `${mark} ${row.theme.padEnd(5)} Lc ${String(row.lc).padStart(5)} / ${row.target}  ${row.fg} on ${row.bg}  (${row.use})`,
  );
}
for (const line of new Set(clipped)) {
  console.log(`FAIL ${line}`);
}
console.log(`${rows.length - failed.length}/${rows.length} pairs pass, ${new Set(clipped).size} gamut failures`);
process.exit(failed.length > 0 || clipped.length > 0 ? 1 : 0);
