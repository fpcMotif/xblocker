# Spec: Chrome Extension Accessibility (a11y) Audit & Remediation

## Goal

Ensure all Chrome Extension pages (`options.html` and `popup.html`) yield 0 `axe-core` v4.12.1 violations in audited states when checked via `agent-browser` over CDP port 9222.

## Problem Statement

Automated accessibility audits via `agent-browser a11y --json` identified structural landmark violations and color contrast failures on `options.html`:

1. **Uncontained Content (`region` rule violation)**:
   - Page content (`.xb-opt-brand-name` "XBlocker" and `.xb-opt-version` "v1.0.0") sits inside `.xb-opt-rail` (`<div>`) outside of any ARIA landmark element.
2. **Insufficient Color Contrast (`color-contrast` rule violation)**:
   - Active navigation item (`.xb-opt-nav-item[aria-current="page"]`): Foreground `#088fe3` on background `#1b3348` yields a contrast ratio of 3.74:1 (below the 4.5:1 WCAG AA threshold for normal text).
   - Primary action buttons (`button[type="submit"][data-variant="primary"]`): White foreground `#ffffff` on primary background `#088fe3` yields a contrast ratio of 3.47:1 (below the 4.5:1 WCAG AA threshold).

## Design & Architecture Changes

### 1. HTML Landmark Structure

- **Options Shell (`entrypoints/options/main.ts`)**:
  - Convert `.xb-opt-rail` container element from `div` to `aside` tag (`<aside class="xb-opt-rail" aria-label="Sidebar">`).
  - This places the sidebar brand header, navigation menu, and version footer inside an `<aside>` landmark region, complementing the `<main class="xb-opt-content">` landmark.

- **Popup Shell (`entrypoints/popup/main.ts`)**:
  - Convert popup root `.xb-popup` container from `main` tag to `div` tag (`<div class="xb-popup" data-xb-surface="popup">`).
  - Wrap popup body sections (stat strip, toggles, sync row) inside a `<main class="xb-popup-main">` element, sitting as a sibling between `<header class="xb-header">` and `<footer class="xb-footer">`.

### 2. Design Tokens & Color Contrast

- **Design Tokens (`entrypoints/lib/design-tokens.ts`)**:
  - Add high-contrast token definitions:
    - `--xb-primary-btn-bg: oklch(0.52 0.17 246)` (sRGB ~`#066bb7`), delivering > 4.6:1 contrast ratio against white text (`#ffffff`).
    - High-contrast text colors for primary links/nav items:
      - Dark theme: `color: oklch(0.78 0.14 246)` (contrast > 5.8:1 against dark elevated surface `#1b3348`).
      - Light theme: `color: oklch(0.48 0.16 246)` (contrast > 5.2:1 against light surface `#ffffff`).

- **Options Styles (`entrypoints/options/styles.ts`)**:
  - Update `.xb-opt-nav-item[aria-current="page"]` to use accessible text color.
  - Update `.xb-opt-btn[data-variant="primary"]` to use `--xb-primary-btn-bg`.

## Verification Plan

1. Re-run `bunx agent-browser@0.33.2 --cdp <WS_URL> a11y --json` against `options.html` across all panes (`#general`, `#whitelist`, `#blocked-log`, `#cloud`, `#about`).
2. Re-run `bunx agent-browser@0.33.2 --cdp <WS_URL> a11y --json` against `popup.html`.
3. Assert 0 accessibility violations across all pages and panes.
4. Run full repository verification suite: `bun run check`.

## Learning Documentation

Document accessibility auditing findings and best practices in:
- `learning-diary.md`
- `learning-diary.html`

Both files apply ASD-STE100 Simplified Technical English structural guidance. Note that full ASD-STE100 compliance requires the official dictionary (asd-ste100.org) and cannot be guaranteed by automated tools.
