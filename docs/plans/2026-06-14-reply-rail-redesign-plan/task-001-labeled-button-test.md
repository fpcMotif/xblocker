# Task 001: Labeled action button — test (Red)

**type**: test
**depends-on**: []
**files**:
- `test/content/labeled-button.test.ts` (new)

## BDD Scenario

```gherkin
Scenario: Labeled action button renders icon, text, and a count chip
  Given a labeled-button config { action: "block", icon: "block", label: "Block all replies", text: "Block all", onClick }
  When the labeled button is created
  Then it renders the action icon, the visible text "Block all", and a count chip element
  And it carries aria-label "Block all replies" and data-action "block"

Scenario: Labeled button preserves the busy/success/error state machine
  Given a created labeled button whose onClick resolves
  When the button is clicked
  Then data-state transitions idle -> busy -> success and the status icon swaps (loading -> check)
  And when onClick rejects, data-state becomes "error" and the status icon is the cross

Scenario: Count chip is hidden at zero
  Given a labeled button with its count set to 0
  Then the count chip is absent from the rendered output and the accessibility tree
  And when the count is set to a value > 0 the chip shows that value with tabular-nums
```

## Steps (what, not how)

1. Add a failing spec file that imports the new labeled-button factory from
   `entrypoints/content/buttons.ts` (e.g. `createLabeledActionButton`).
2. Assert the DOM contract above: icon node, visible text node, count chip node, the
   `aria-label`/`data-action` attributes, and the idle→busy→success/error transitions
   (reuse the fake-timer helper in `test/helpers/timers.ts` for the state-reset delay).
3. Assert the hidden-at-zero rule for the count chip (absent at 0, present + correct text
   when > 0). Isolate `onClick` with a resolved/rejected test double — no network.

## Verification

- `bun test test/content/labeled-button.test.ts` runs and **fails** (Red) because the
  labeled factory does not exist yet.
- The failure is a missing-symbol / unmet-assertion failure, not a syntax error in the spec.

## Contract (allowed — signature only, no body)

```ts
export type LabeledActionButtonConfig = ActionButtonConfig & {
  text: string;
  count?: number;
};
export function createLabeledActionButton(config: LabeledActionButtonConfig): HTMLButtonElement;
export function setButtonCount(button: HTMLButtonElement, count: number): void;
```
