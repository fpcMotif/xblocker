# Product

## Register

product

## Users

A single owner: a power user of x.com (browsing in zh-Hant) who cleans reply-spam
under viral posts. Context: mid-scroll on a busy thread, one hand on the mouse,
wanting spam accounts gone in one click without leaving the page. The popup is a
settings-and-status surface opened for seconds, not minutes.

## Product Purpose

XBlocker blocks and mutes reply-spam accounts on x.com — one-click per reply,
bulk "block all / mute all" per thread, a whitelist of protected handles, and an
opt-in mirror of the blocked list to the owner's personal Convex deployment.
Success: spam disappears with near-zero interaction cost, and nothing the tool
injects ever feels foreign on the page.

## Brand Personality

Calm, precise, invisible. The working name for the visual system is **Calm
Control**: quiet neutral surfaces, one decisive accent per action tone, motion
only as state feedback. The tool should disappear into the task of reading X.

## Anti-references

- A wholesale X/Twitter clone (the old popup: `#1d9bf0` buttons, `#050607`
  backgrounds). XBlocker sits *on* X; it should not cosplay *as* X.
- Aggressive "blocker" aesthetics — big red warnings, skull-and-crossbones
  energy. Blocking here is routine hygiene, not drama.
- SaaS dashboard tropes: hero-metric cards with gradient accents, decorative
  glassmorphism, orchestrated page-load choreography.

## Design Principles

1. **One system, every surface.** The content-script rail/console/toast/modal,
   the popup, and any design previews all derive from the same OKLCH token
   source. A color changed once changes everywhere.
2. **Quiet by default, decisive on action.** Neutral ink-on-surface at rest;
   the accent, danger, and success hues appear only on interaction and state.
3. **Earned familiarity.** Standard affordances (switches, rows, buttons)
   executed impeccably beat invented ones. No dead controls — every visible
   affordance works.
4. **Every state designed.** Hover (pointer-gated), focus-visible, active
   (scale 0.96), disabled, busy, success, error — for every interactive
   element, on both surfaces.
5. **Motion is state feedback.** 150–250 ms, strong ease-out, interruptible
   transitions, `prefers-reduced-motion` keeps fades and drops movement.

## Accessibility & Inclusion

WCAG AA contrast (≥4.5:1 body, ≥3:1 large); `:focus-visible` rings on every
control; ≥40×40 px effective hit areas (pseudo-element extension where the
visible control is smaller); hover effects gated behind
`(hover: hover) and (pointer: fine)`; full `prefers-reduced-motion` handling;
popup follows the OS light/dark scheme rather than forcing dark.
