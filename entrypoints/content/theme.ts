export type ThemeName = "dark" | "light";

/** Parse an rgb()/rgba() string to its channels, or null if it carries no
 *  usable surface color (unparseable, or fully transparent). */
function parseRgb(color: string): [number, number, number] | null {
  const match = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/.exec(color);
  if (!match) {
    return null;
  }
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha === 0) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function detectTheme(): ThemeName {
  const html = document.documentElement;
  const body = document.body;

  // 1. Authoritative: an explicit color-scheme declared on <html>.
  const scheme = html.style.colorScheme;
  if (scheme === "dark") {
    return "dark";
  }
  if (scheme === "light") {
    return "light";
  }

  // 2. Authoritative: the page's actual surface. X paints the body black in
  //    lights-out, near-black in dim, and white in light — so its luminance
  //    settles the question without trusting weaker hints.
  const rgb = parseRgb(body.style.backgroundColor || getComputedStyle(body).backgroundColor);
  if (rgb) {
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return luminance < 128 ? "dark" : "light";
  }

  // 3. Surface indeterminate (transparent/unstyled): fall back to weak hints.
  //    These no longer override a clearly-light surface, which is what flipped
  //    the rail dark-on-light before.
  const weakDark =
    document.querySelector('[data-theme="dark"]') !== null ||
    document.querySelector('meta[name="theme-color"][content="#000000"]') !== null;
  return weakDark ? "dark" : "light";
}

export function applyTheme(): void {
  const theme = detectTheme();
  for (const root of document.querySelectorAll<HTMLElement>(".xb-root")) {
    root.dataset.xbTheme = theme;
  }
}

let activeObserver: MutationObserver | null = null;

export function observeThemeChanges(): MutationObserver {
  // checkPageAndAddButton calls this on every SPA navigation; replacing the
  // previous observer keeps exactly one subscription pair alive.
  activeObserver?.disconnect();

  const observer = new MutationObserver(() => {
    applyTheme();
  });

  const options = { attributes: true, attributeFilter: ["style", "class", "data-theme"] };
  observer.observe(document.documentElement, options);
  observer.observe(document.body, options);

  activeObserver = observer;
  return observer;
}
