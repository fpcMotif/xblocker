// About pane: static build info + links, per plan.md's About spec. The GitHub URL is
// hardcoded from package.json's "repository" field — a plain extension page has no
// bundler-safe way to read package.json at runtime, and this value never changes
// without a source edit anyway.

import * as stylex from "@stylexjs/stylex";
import { createIcon } from "../../lib/icons";
import { optionsShellStyles as styles } from "../options-shell.stylex";

const REPO_URL = "https://github.com/daymade/Twitter-Block-Porn";

type PaneHandle = { destroy(): void };

/** Guarded the same way the rail's pinned version is (see main.ts's buildVersionFooter):
 *  the test chrome mock has no getManifest. */
function manifestVersion(): string | undefined {
  return chrome.runtime.getManifest?.()?.version;
}

export function renderAboutPane(container: HTMLElement): PaneHandle {
  const wrapper = document.createElement("div");
  wrapper.className = `${stylex.props(styles.paneForm).className} xb-opt-pane-form`;

  const header = document.createElement("div");
  header.className = `${stylex.props(styles.paneHeader).className} xb-opt-pane-header`;
  const h1 = document.createElement("h1");
  h1.className = `${stylex.props(styles.paneHeaderH1).className}`;
  h1.textContent = "About";
  const desc = document.createElement("p");
  desc.className = `${stylex.props(styles.paneHeaderP).className}`;
  desc.textContent = "Build information and links.";
  header.append(h1, desc);

  const mark = document.createElement("div");
  mark.className = `${stylex.props(styles.aboutMark).className} xb-opt-about-mark`;
  mark.appendChild(createIcon("shield", 18));

  const version = document.createElement("p");
  version.className = `${stylex.props(styles.aboutVersion).className} xb-opt-about-version`;
  const versionNumber = manifestVersion();
  version.textContent = versionNumber ? `Version ${versionNumber}` : "Version unknown";

  const tagline = document.createElement("p");
  tagline.className = `${stylex.props(styles.aboutTagline).className} xb-opt-about-tagline`;
  tagline.textContent =
    "Local-first reply-spam blocking for X, with optional private cloud backup.";

  const link = document.createElement("a");
  link.className = `${stylex.props(styles.linkRow).className} xb-opt-link-row`;
  link.style.marginBottom = "16px";
  link.href = REPO_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View source on GitHub ↗";

  const privacy = document.createElement("p");
  privacy.className = `${stylex.props(styles.rowCaption).className} xb-opt-row-caption`;
  privacy.textContent = "Data stays on this device unless cloud backup is turned on.";

  wrapper.append(header, mark, version, tagline, link, privacy);
  container.replaceChildren(wrapper);

  return {
    destroy() {},
  };
}
