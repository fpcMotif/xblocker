// Settings-page shell: two-pane layout (left rail + a routed content pane) per
// docs/plans/2026-07-10-gauge-and-ledger/plan.md, "Settings page". Hash routing
// (#general default, #whitelist, #blocked-log, #cloud, #about) is deliberately minimal —
// nav clicks call `navigate()` directly (so the render is deterministic and testable
// without depending on a real browser's anchor-click-triggers-navigation behavior) and
// also stamp `window.location.hash` so the route is shareable/bookmarkable in real use.
// Each pane module owns its own mount/destroy lifecycle; switching routes tears down the
// outgoing pane (unsubscribing storage watchers, clearing debounces) before the
// incoming one takes over.
//
// navigate() renders every pane into a detached staging element first, not the live
// `content` container: a pane's own render function calls container.replaceChildren
// partway through its async load, so by the time navigate() could check whether it lost
// a navigation race, a stale pane may have already overwritten the DOM. Staging first and
// re-checking the generation token right before transplanting its children into `content`
// means a superseded navigation never touches the shared container at all — the winning
// navigation is always the one that renders last.

import { createIcon } from "../lib/icons";
import { renderAboutPane } from "./panes/about";
import { renderBlockedLogPane } from "./panes/blocked-log";
import { renderCloudPane } from "./panes/cloud";
import { renderGeneralPane } from "./panes/general";
import { renderWhitelistPane } from "./panes/whitelist";
import { ensureOptionsStyles } from "./styles";

export type OptionsRoute = "about" | "blocked-log" | "cloud" | "general" | "whitelist";

const DEFAULT_ROUTE: OptionsRoute = "general";

type RouteDef = { id: OptionsRoute; label: string; icon: () => SVGSVGElement };

/** A small inline "info" glyph for the About tab — lib/icons.ts's fixed icon set (block,
 *  mute, whitelist, shield, settings, drag, check, cross, loading) has no info mark, and
 *  it belongs to a different ownership boundary than this settings shell. */
function createInfoIcon(size: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "display: block; flex-shrink: 0; pointer-events: none;";
  svg.innerHTML =
    '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/>' +
    '<path d="M12 11v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="12" cy="7.5" r="1.25" fill="currentColor"/>';
  return svg;
}

const ROUTES: readonly RouteDef[] = [
  { id: "general", label: "General", icon: () => createIcon("settings", 18) },
  { id: "whitelist", label: "Whitelist", icon: () => createIcon("whitelist", 18) },
  { id: "blocked-log", label: "Blocked log", icon: () => createIcon("block", 18) },
  { id: "cloud", label: "Cloud backup", icon: () => createIcon("shield", 18) },
  { id: "about", label: "About", icon: () => createInfoIcon(18) },
];

function isOptionsRoute(value: string): value is OptionsRoute {
  return ROUTES.some((route) => route.id === value);
}

function routeFromHash(): OptionsRoute {
  const raw = (window.location.hash ?? "").replace(/^#/, "");
  return isOptionsRoute(raw) ? raw : DEFAULT_ROUTE;
}

function buildBrandRow(): HTMLElement {
  const brand = document.createElement("div");
  brand.className = "xb-opt-brand";

  const mark = document.createElement("span");
  mark.className = "xb-opt-brand-mark";
  mark.appendChild(createIcon("shield", 14));

  const name = document.createElement("span");
  name.className = "xb-opt-brand-name";
  name.textContent = "XBlocker";

  brand.append(mark, name);
  return brand;
}

type NavControl = { element: HTMLElement; setActive(route: OptionsRoute): void };

function buildNav(
  activeRoute: OptionsRoute,
  onNavigate: (route: OptionsRoute) => void,
): NavControl {
  const nav = document.createElement("nav");
  nav.className = "xb-opt-nav";
  nav.setAttribute("aria-label", "Settings sections");

  const links = new Map<OptionsRoute, HTMLAnchorElement>();

  for (const route of ROUTES) {
    const link = document.createElement("a");
    link.className = "xb-opt-nav-item";
    link.href = `#${route.id}`;
    link.dataset.route = route.id;
    link.appendChild(route.icon());

    const label = document.createElement("span");
    label.textContent = route.label;
    link.appendChild(label);

    if (route.id === activeRoute) link.setAttribute("aria-current", "page");

    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.hash = `#${route.id}`;
      onNavigate(route.id);
    });

    links.set(route.id, link);
    nav.appendChild(link);
  }

  return {
    element: nav,
    setActive(route) {
      for (const [id, link] of links) {
        if (id === route) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    },
  };
}

function buildVersionFooter(): HTMLElement {
  const el = document.createElement("div");
  el.className = "xb-opt-version";
  const version = chrome.runtime.getManifest?.()?.version;
  el.textContent = version ? `v${version}` : "";
  return el;
}

type PaneHandle = { destroy(): void };

/** Minimal inline failure state for a pane whose async load rejected (e.g. a storage
 *  read failure). Reuses the existing empty-state/link-row styling rather than adding a
 *  new CSS shape for what is, visually, just another "nothing to show here" card. */
function renderPaneLoadError(container: HTMLElement, onRetry: () => void): void {
  const wrapper = document.createElement("div");
  wrapper.className = "xb-opt-empty";

  const message = document.createElement("p");
  message.textContent = "Couldn't load this page.";

  const retry = document.createElement("a");
  retry.href = "#";
  retry.className = "xb-opt-link-row";
  retry.textContent = "Try again";
  retry.addEventListener("click", (event) => {
    event.preventDefault();
    onRetry();
  });

  wrapper.append(message, retry);
  container.replaceChildren(wrapper);
}

function mountPane(route: OptionsRoute, container: HTMLElement): Promise<PaneHandle> {
  switch (route) {
    case "general":
      return renderGeneralPane(container);
    case "whitelist":
      return renderWhitelistPane(container);
    case "blocked-log":
      return renderBlockedLogPane(container);
    case "cloud":
      return renderCloudPane(container);
    case "about":
      return Promise.resolve(renderAboutPane(container));
    default:
      throw new Error("Unknown options route");
  }
}

export async function renderOptions(root: HTMLElement): Promise<void> {
  ensureOptionsStyles();

  const shell = document.createElement("div");
  shell.className = "xb-opt-root";

  const rail = document.createElement("div");
  rail.className = "xb-opt-rail";
  rail.appendChild(buildBrandRow());

  const content = document.createElement("main");
  content.className = "xb-opt-content";

  let currentRoute: OptionsRoute | undefined;
  let currentHandle: PaneHandle | undefined;
  let navToken = 0;

  async function navigate(route: OptionsRoute): Promise<void> {
    if (route === currentRoute) return;
    currentRoute = route;
    navControl.setActive(route);
    const token = ++navToken;
    const outgoing = currentHandle;

    // Mount into a detached staging element so a pane's own mid-load
    // container.replaceChildren never reaches the live DOM until we know this
    // navigation actually won its race (checked below, before it touches `content`).
    const staging = document.createElement("div");
    let handle: PaneHandle;
    try {
      handle = await mountPane(route, staging);
    } catch {
      if (token !== navToken) return; // superseded — the winning navigation owns the error, not us
      // The route never finished loading, so nothing is currently mounted for it. Reset
      // currentRoute (rather than leaving it pinned to this route) so the nav item is
      // re-navigable — including re-clicking the very route that just failed.
      outgoing?.destroy();
      currentHandle = undefined;
      currentRoute = undefined;
      renderPaneLoadError(content, () => void navigate(route));
      return;
    }

    if (token !== navToken) {
      // A newer navigation started while this one was still loading; the just-built
      // pane lost the race and was never attached to `content`, so just tear it down.
      handle.destroy();
      return;
    }
    outgoing?.destroy();
    content.replaceChildren(...Array.from(staging.childNodes));
    currentHandle = handle;
  }

  const navControl = buildNav(routeFromHash(), (route) => {
    void navigate(route);
  });

  rail.append(navControl.element, buildVersionFooter());
  shell.append(rail, content);
  root.replaceChildren(shell);

  await navigate(routeFromHash());
}

export function mountOptionsIfPresent(): void {
  const appRoot = document.getElementById("app");
  if (appRoot) {
    void renderOptions(appRoot);
  }
}

mountOptionsIfPresent();
