# Task 004: Distinct shield glyph icon — impl (Green)

**type**: impl
**depends-on**: ["003"]
**files**:
- `entrypoints/content/icons.ts`

## BDD Scenario

```gherkin
Scenario: A distinct shield glyph exists for the puck and session indicator
  Given the icon factory createIcon
  When createIcon("shield") is called
  Then it returns an <svg> with a shield glyph distinct from the whitelist shield-check
```

## Steps (what, not how)

1. Add `"shield"` to `IconType` and a corresponding entry in `ICON_PATHS` — a solid/half
   shield silhouette (no check mark) so it is visually distinct from the existing
   `whitelist` shield-check used for the whitelist button.
2. Keep stroke conventions consistent with the other icons (`currentColor`, 24x24 viewBox).

## Verification

- `bun test test/content/icons.test.ts` passes (Green).
- `bun run typecheck` passes (exhaustive `ICON_PATHS` record still satisfied).
