# Task 013: Dead-style cleanup + full green gate (100% coverage)

**type**: refactor
**depends-on**: ["006", "010", "012"]
**files**:
- `entrypoints/content/styles.ts`
- `test/content/*` (coverage top-ups only — no behavior change)

## BDD Scenario

```gherkin
Scenario: The project gate is green with full coverage and no dead styles
  Given the redesign (Tasks 002-012) is implemented
  When `bun run check` runs (typecheck, lint, format:check, bun test, wxt build)
  Then it passes
  And test coverage remains 100% (the project coverage gate)
  And the removed surfaces leave no dead CSS: .xb-ring*, .xb-console*, .xb-divider-v,
    .xb-handle-count, and the old heavy three-layer dock shadow are gone
  And no test references the removed DOM (.xb-handle-count / .xb-ring*)
```

## Steps (what, not how)

1. Delete now-unused CSS from `styles.ts`: `.xb-ring*`, the cursor-console block
   (`.xb-console*`, `.xb-divider-v`) if no longer mounted, `.xb-handle-count`, and the
   old multi-layer dock shadow — confirm via search that nothing references them.
2. Run the full coverage report; add focused tests for any line/branch the redesign left
   uncovered (e.g. hidden-at-zero edge, progress clear, collapsed badge toggle). No new
   product behavior — coverage only.
3. Run `bun run format` so `format:check` passes.

## Verification

- `bun run check` is fully green.
- `bun run test:coverage` shows 100% (matches the project gate).
- `rg -n "xb-ring|xb-handle-count|xb-console" entrypoints test` returns no stale references.
