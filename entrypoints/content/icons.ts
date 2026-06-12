export type IconType =
  | "block"
  | "mute"
  | "whitelist"
  | "settings"
  | "drag"
  | "check"
  | "cross"
  | "loading";

const ICON_PATHS: Record<Exclude<IconType, "loading" | "drag">, string> = {
  block: `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
		<path d="M5.5 5.5l13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  mute: `<path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
		<path d="M22 9l-6 6M16 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  whitelist: `<path d="M12 3l7 3v5c0 4.5-3 8.1-7 9.5C8 19.1 5 15.5 5 11V6l7-3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/>
		<path d="M9.2 11.8l2 2 3.8-3.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  settings: `<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.6-1.2H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.56.74.94 1.33 1H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  cross: `<path d="M7 7l10 10m0-10L7 17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,
};

export function createIcon(type: IconType, size = 18): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display: block; flex-shrink: 0; pointer-events: none;";

  if (type === "loading") {
    svg.classList.add("xb-spin");
    svg.innerHTML = `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-dasharray="42" stroke-dashoffset="28"/>`;
    return svg;
  }

  if (type === "drag") {
    const dots = [];
    for (const y of [6, 12, 18]) {
      for (const x of [9, 15]) {
        dots.push(`<circle cx="${x}" cy="${y}" r="1.4" fill="currentColor"/>`);
      }
    }
    svg.innerHTML = dots.join("");
    return svg;
  }

  svg.innerHTML = ICON_PATHS[type];
  return svg;
}
