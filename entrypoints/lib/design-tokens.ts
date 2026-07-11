// Canonical "Calm Control" token source. content/styles.ts interpolates these
// declaration-list strings into its SHEET instead of duplicating the literals, so the
// dark/light OKLCH values and the type stack have exactly one definition.

/** The Inter-first font stack every XBlocker surface renders with. */
export const XB_FONT_STACK =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Theme-independent tone + easing custom properties declared on `.xb-root`. */
export const XB_TONE_TOKENS = `
	--xb-primary: oklch(0.63 0.16 246);
	--xb-danger: oklch(0.601 0.212 21);
	--xb-success: oklch(0.646 0.152 154);
	--xb-warning: oklch(0.778 0.158 74);
	--xb-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
	--xb-ease-icon: cubic-bezier(0.2, 0, 0, 1);
`;

/** Surface/ink/shadow custom properties for `.xb-root[data-xb-theme="dark"]`. */
export const XB_DARK_TOKENS = `
	--xb-surface: oklch(0.2 0.022 259);
	--xb-elevated: oklch(0.27 0.025 255);
	--xb-ink: oklch(0.97 0.006 255);
	--xb-ink-muted: oklch(0.72 0.02 255);
	--xb-border: oklch(1 0 0 / 0.12);
	--xb-track: oklch(1 0 0 / 0.14);
	--xb-hero-bg: oklch(0.98 0 0);
	--xb-hero-ink: oklch(0.2 0.02 259);
	--xb-shadow: 0 8px 24px oklch(0 0 0 / 0.5), 0 0 0 0.5px oklch(1 0 0 / 0.06);
`;

/** Surface/ink/shadow custom properties for `.xb-root[data-xb-theme="light"]`. */
export const XB_LIGHT_TOKENS = `
	--xb-surface: oklch(1 0 0);
	--xb-elevated: oklch(0.984 0.003 248);
	--xb-ink: oklch(0.24 0.023 251);
	--xb-ink-muted: oklch(0.5 0.02 251);
	--xb-border: oklch(0.906 0.015 251);
	--xb-track: oklch(0.24 0.023 251 / 0.08);
	--xb-hero-bg: oklch(0.2 0.02 251);
	--xb-hero-ink: oklch(1 0 0);
	--xb-shadow: 0 6px 20px oklch(0 0 0 / 0.12), 0 0 0 0.5px oklch(0 0 0 / 0.06);
`;
