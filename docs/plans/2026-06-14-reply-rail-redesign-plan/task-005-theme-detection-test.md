# Task 005: Theme detection fidelity — test (Red)

**type**: test
**depends-on**: []
**files**:
- `test/content/theme-detection.test.ts` (new)

## BDD Scenario

```gherkin
Scenario: Rail matches X light mode
  Given a page whose body background is white and colorScheme is light, with no dark markers
  When detectTheme() runs
  Then it returns "light"

Scenario: Rail matches X dark/dim mode
  Given a page whose body background is black (or html colorScheme "dark")
  When detectTheme() runs
  Then it returns "dark"

Scenario: A weak/non-authoritative dark signal does not override a clearly light page
  Given a light page (white body, colorScheme light) that ALSO exposes a single weak dark
    signal (the observed misfire, e.g. a stray meta theme-color)
  When detectTheme() runs
  Then it returns "light" — authoritative surface signals win over weak ones
```

## Steps (what, not how)

1. Add a failing spec importing `detectTheme` from `entrypoints/content/theme.ts`.
2. Drive each scenario by setting the relevant DOM state on happy-dom
   (`document.body.style.backgroundColor`, `documentElement.style.colorScheme`,
   `<meta name="theme-color">`, `[data-theme]`) and asserting the returned theme.
3. The third scenario asserts the **precedence rule**: a clearly-light surface is not
   flipped to dark by a single weak signal. Reset DOM between cases.

## Verification

- `bun test test/content/theme-detection.test.ts` runs and **fails** (Red) on the
  precedence scenario (current `detectTheme` over-triggers on the weak signal).
