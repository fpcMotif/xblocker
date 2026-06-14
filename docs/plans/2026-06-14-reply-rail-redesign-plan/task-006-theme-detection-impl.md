# Task 006: Theme detection fidelity — impl (Green)

**type**: impl
**depends-on**: ["005"]
**files**:
- `entrypoints/content/theme.ts`

## BDD Scenario

```gherkin
Scenario: A weak/non-authoritative dark signal does not override a clearly light page
  Given a light page that also exposes a single weak dark signal
  When detectTheme() runs
  Then it returns "light"
  And dark/dim X pages still resolve to "dark"
```

## Steps (what, not how)

1. Re-order `detectTheme` to prefer **authoritative surface signals** (computed body
   background / `html.colorScheme`) over weak ones, so a clearly-light surface is not
   flipped to dark by a lone weak signal. Keep `applyTheme` / `observeThemeChanges`.
2. **Verify against the live X page** during implementation (light, dim, and dark modes)
   so the rail surface matches X's actual mode — the screenshot misfire (dark rail on a
   light page) must not reproduce. No new dependency; pure DOM inspection.

## Verification

- `bun test test/content/theme-detection.test.ts` passes (Green).
- Existing `test/content/ui-rendering.test.ts` theme assertion still passes.
- Manual: load the unpacked build on an X status page in light and dark modes; the rail
  surface matches the page in both.
