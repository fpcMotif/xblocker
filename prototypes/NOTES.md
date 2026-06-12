# Reply Rail prototype — notes

PROTOTYPE — throwaway. Delete this directory once the verdict below is filled in and
folded into the spec.

**Question:** which motion personality should the Reply Rail use?
(spec: `docs/superpowers/specs/2026-06-12-reply-rail-design.md`)

**Run:** `open prototypes/reply-rail-prototype.html` (or the Launch preview panel).
Switch variants with the bottom pill or ←/→ keys.

- `?variant=A` — Glide: damped lerp (factor 0.22)
- `?variant=B` — Spring: stiffness 170 / damping 13, slight overshoot
- `?variant=C` — Magnetic rows: rail aligns to the hovered reply's center, steps row-to-row

Also tune-able by feel here: 1s dwell-to-settle, 4px jitter threshold, 600ms collapse
grace. Debug readout top-left shows state + dwell countdown.

**Verdict:** _TBD — fill in the winning variant and any timing adjustments._
