export type ThemeName = "dark" | "light";

export function detectTheme(): ThemeName {
  const html = document.documentElement;
  const body = document.body;

  const isDark =
    html.style.colorScheme === "dark" ||
    body.style.backgroundColor === "rgb(0, 0, 0)" ||
    getComputedStyle(body).backgroundColor === "rgb(0, 0, 0)" ||
    document.querySelector('[data-theme="dark"]') !== null ||
    document.querySelector('meta[name="theme-color"][content="#000000"]') !== null;

  return isDark ? "dark" : "light";
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
