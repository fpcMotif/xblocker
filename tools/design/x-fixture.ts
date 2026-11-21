// A static stand-in for an x.com status page: the three host themes, X's font-size
// steps, and worst-case reply data. It reproduces only what the content script reads
// (tweet articles, bylines, tweet text) and the inherited styles X puts on <body>.

export type HostTheme = "default" | "dim" | "lights-out";

export const HOST_THEMES: Record<
  HostTheme,
  { background: string; text: string; border: string; scheme: "light" | "dark" }
> = {
  default: { background: "#FFFFFF", text: "#0F1419", border: "#EFF3F4", scheme: "light" },
  dim: { background: "#15202B", text: "#F7F9F9", border: "#38444D", scheme: "dark" },
  "lights-out": { background: "#000000", text: "#E7E9EA", border: "#2F3336", scheme: "dark" },
};

/** The root font sizes X's "Font size" slider sets on <html>. */
export const HOST_FONT_SIZES = [14, 15, 17, 18, 20] as const;

export const FIXTURE_URL = "https://x.com/design_fixture/status/1234567890";

type Reply = { name: string; handle: string; text: string };

const REPLIES: Reply[] = [
  { name: "Ada", handle: "ada", text: "Short reply." },
  {
    name: "A display name that runs far past the column and keeps going and going",
    handle: "WWWWWWWWWWWWWWW",
    text: "Longest legal handle, fifteen wide glyphs, next to a display name that must truncate.",
  },
  {
    name: "田中太郎",
    handle: "tanaka_taro",
    text: "これは日本語の返信です。長い文章でも折り返しが正しく動作するか確認します。",
  },
  {
    name: "ليلى",
    handle: "layla_dev",
    text: "هذا رد باللغة العربية لاختبار اتجاه النص من اليمين إلى اليسار.",
  },
  { name: "🚀🚀🚀", handle: "x", text: "One-letter handle and an emoji-only name." },
  {
    name: "Link spammer",
    handle: "free_crypto_now",
    text: "Unbroken: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
];

function article(reply: Reply): string {
  return `
<article data-testid="tweet" tabindex="0">
  <div data-testid="User-Name">
    <a href="/${reply.handle}" role="link"><span dir="auto">${reply.name}</span></a>
    <a href="/${reply.handle}" role="link" tabindex="-1"><span>@${reply.handle}</span></a>
  </div>
  <div data-testid="tweetText" dir="auto">${reply.text}</div>
</article>`;
}

export function statusPageHtml(options: { theme: HostTheme; fontSize?: number }): string {
  const theme = HOST_THEMES[options.theme];
  const replies = REPLIES.map(article).join("");

  return `<!doctype html>
<html lang="en" style="color-scheme: ${theme.scheme}; font-size: ${options.fontSize ?? 15}px;">
<head>
<meta charset="utf-8">
<title>Fixture status / X</title>
<style>
  body {
    margin: 0;
    background-color: ${theme.background};
    color: ${theme.text};
    font-family: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.3125;
    overflow-y: scroll;
    overscroll-behavior-y: none;
    -webkit-text-size-adjust: 100%;
  }
  main { width: 600px; margin: 0 auto; border-inline: 1px solid ${theme.border}; min-height: 100vh; }
  article { padding: 0.8rem 1.07rem; border-bottom: 1px solid ${theme.border}; font-size: 1rem; overflow-wrap: anywhere; }
  article a { color: inherit; text-decoration: none; }
  [data-testid="User-Name"] { display: flex; gap: 4px; font-weight: 700; white-space: nowrap; overflow: hidden; }
  [data-testid="User-Name"] a:first-child { overflow: hidden; text-overflow: ellipsis; }
  [data-testid="User-Name"] a + a { font-weight: 400; opacity: 0.6; }
</style>
</head>
<body style="background-color: ${theme.background};">
<main role="main">
  ${article({ name: "Thread author", handle: "design_fixture", text: "The post everyone is replying to." })}
  ${replies}
</main>
</body>
</html>`;
}
