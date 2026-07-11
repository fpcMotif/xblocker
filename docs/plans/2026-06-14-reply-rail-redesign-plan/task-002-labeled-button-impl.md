# Task 002: Labeled action button — impl (Green)

**type**: impl
**depends-on**: ["001"]
**files**:
- `entrypoints/content/buttons.ts`
- `entrypoints/content/styles.ts` (labeled-button visual rules only)

## BDD Scenario

```gherkin
Scenario: Labeled action button renders icon, text, and a count chip
  Given a labeled-button config { action, icon, label, text, count, onClick }
  When the labeled button is created
  Then it renders the action icon, the visible text, and a count chip
  And it preserves the existing busy/success/error icon-swap state machine on click
  And the count chip is hidden (absent from view and the a11y tree) when count is 0
```

## Steps (what, not how)

1. Add `createLabeledActionButton` to `buttons.ts` that composes the existing
   icon-swap state machine (`xb-icon-main` / `xb-icon-status`, busy/success/error) with a
   visible text label and an optional count chip (class `.xb-count`, `tabular-nums`).
2. Add `setButtonCount(button, count)` that updates the chip text and toggles visibility:
   hidden + removed from the a11y tree when 0, shown when > 0.
3. Add the labeled-button CSS (label typography, chip pill, hero vs outline variants keyed
   off `data-action` / a `data-variant` attribute) to `styles.ts`. Hero = black bg/white
   text; secondary = transparent bg + hairline outline. Do not restyle the icon-only path.
4. Keep the existing icon-only `createActionButton` intact (footer whitelist/settings use it).

## Verification

- `bun test test/content/labeled-button.test.ts` passes (Green).
- `bun run typecheck` and `bun run lint` pass for the changed files.
