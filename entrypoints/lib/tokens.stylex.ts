import * as stylex from "@stylexjs/stylex";

const DARK = "@media (prefers-color-scheme: dark)";

/**
 * Calm Control design tokens for XBlocker surfaces.
 * Compiled with StyleX defineVars, preserving the historical custom properties (--xb-*)
 * so all surfaces (options, popup, and any inline SVG styles) resolve identically.
 */
export const tokens = stylex.defineVars({
  // Font Stack
  "--xb-font-stack":
    "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",

  // Tone & Easing
  "--xb-primary": "oklch(0.63 0.16 246)",
  "--xb-primary-btn-bg": "oklch(0.52 0.17 246)",
  "--xb-danger": "oklch(0.601 0.212 21)",
  "--xb-success": "oklch(0.646 0.152 154)",
  "--xb-warning": "oklch(0.778 0.158 74)",
  "--xb-ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
  "--xb-ease-icon": "cubic-bezier(0.2, 0, 0, 1)",

  // Surface, Ink, Borders, Shadows (Light & Dark)
  "--xb-surface": {
    default: "oklch(1 0 0)",
    [DARK]: "oklch(0.2 0.022 259)",
  },
  "--xb-elevated": {
    default: "oklch(0.984 0.003 248)",
    [DARK]: "oklch(0.27 0.025 255)",
  },
  "--xb-ink": {
    default: "oklch(0.24 0.023 251)",
    [DARK]: "oklch(0.97 0.006 255)",
  },
  "--xb-ink-muted": {
    default: "oklch(0.5 0.02 251)",
    [DARK]: "oklch(0.72 0.02 255)",
  },
  "--xb-primary-text": {
    default: "oklch(0.48 0.16 246)",
    [DARK]: "oklch(0.78 0.14 246)",
  },
  "--xb-border": {
    default: "oklch(0.906 0.015 251)",
    [DARK]: "oklch(1 0 0 / 0.12)",
  },
  "--xb-track": {
    default: "oklch(0.24 0.023 251 / 0.08)",
    [DARK]: "oklch(1 0 0 / 0.14)",
  },
  "--xb-hero-bg": {
    default: "oklch(0.2 0.02 251)",
    [DARK]: "oklch(0.98 0 0)",
  },
  "--xb-hero-ink": {
    default: "oklch(1 0 0)",
    [DARK]: "oklch(0.2 0.02 259)",
  },
  "--xb-shadow": {
    default: "0 6px 20px oklch(0 0 0 / 0.12), 0 0 0 0.5px oklch(0 0 0 / 0.06)",
    [DARK]: "0 8px 24px oklch(0 0 0 / 0.5), 0 0 0 0.5px oklch(1 0 0 / 0.06)",
  },
});
