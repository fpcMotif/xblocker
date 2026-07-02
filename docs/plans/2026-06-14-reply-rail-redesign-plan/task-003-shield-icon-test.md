# Task 003: Distinct shield glyph icon — test (Red)

**type**: test
**depends-on**: []
**files**:
- `test/content/icons.test.ts` (new)

## BDD Scenario

```gherkin
Scenario: A distinct shield glyph exists for the puck and session indicator
  Given the icon factory createIcon
  When createIcon("shield") is called
  Then it returns an <svg> element with a 24x24 viewBox and a shield glyph path
  And the "shield" markup differs from the "whitelist" (shield-check) markup
  And createIcon("shield", 22) honours the requested size
```

## Steps (what, not how)

1. Add a failing spec importing `createIcon` from `entrypoints/content/icons.ts`.
2. Assert `createIcon("shield")` returns an `SVGSVGElement` with the expected viewBox and
   a non-empty glyph, and that its `innerHTML` is **not** equal to `createIcon("whitelist")`
   (the two shields must be visually distinct).
3. Assert the size argument is applied to width/height.

## Verification

- `bun test test/content/icons.test.ts` runs and **fails** (Red): `"shield"` is not yet a
  valid `IconType`.

## Contract (allowed — type extension only)

```ts
export type IconType =
  | "block" | "mute" | "whitelist" | "settings" | "drag"
  | "check" | "cross" | "loading"
  | "shield"; // new: solid/half shield for puck + session indicator
```
