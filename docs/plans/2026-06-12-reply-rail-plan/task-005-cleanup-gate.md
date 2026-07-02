# Task 005: Cleanup and gate

**depends-on**: task-001-rail-geometry-impl, task-002-rail-state-impl, task-003-rail-actions-impl, task-004-content-wiring-impl

## Description

Delete the superseded surfaces and their suites, scrub stale references, and prove the
full quality gate.

## Execution Context

**Task Number**: 005 of 005
**Phase**: Refinement
**Prerequisites**: all impl tasks merged; rail suites green.

## BDD Scenario

```gherkin
Scenario: The old surfaces are gone
  When the repo is searched for CursorConsole, computeConsolePosition, or the Dock class
  Then no source or test file references them
  And entrypoints/content/console.ts and dock.ts do not exist

Scenario: The quality gate is fully green
  When bun run check runs (tsgo, oxlint, oxfmt, bun test, wxt build)
  Then every step passes
  And test coverage is 100% (workflow constraint)
```

**Spec Source**: `docs/superpowers/specs/2026-06-12-reply-rail-design.md` § Testing

## Files to Modify/Create

- Delete: `entrypoints/content/console.ts`
- Delete: `entrypoints/content/dock.ts`
- Delete: `test/content/cursor-console.test.ts`
- Delete: `test/content/dock.test.ts`
- Modify: `entrypoints/content/position.ts` (drop the legacy `computeConsolePosition` export kept by task 001)
- Modify: `test/content/position.test.ts` (drop the legacy describe block kept by task 001)
- Modify: `test/content/misc-coverage.test.ts` (its header comment references `cursor-console.test.ts` and explains coverage attribution between suites — rewrite it for the rail suites)
- Modify: `docs/test-plan.md` (add a rail section; the file currently has no console/dock sections to replace)

## Steps

### Step 1: Delete and scrub
- Remove the four files and the two legacy code blocks;
  `rg -i "cursorconsole|cursor-console|computeConsolePosition|consoleGraceMs|getDock\b|reply-action-bar"` across source and tests must return nothing
- Check `README.md` / `CONTEXT.md` for console/dock surface descriptions; update only
  sentences that describe the deleted surfaces (concurrent sessions edit these files —
  keep the diff minimal and stage explicitly)
- Re-check coverage attribution in `misc-coverage.test.ts`: with the old suites gone,
  some branches it existed to cover may now be covered (or uncovered) differently

### Step 2: Gate
- **Verification**: `bun run check` fully green; coverage report shows 100%

## Verification Commands

```bash
rg -i "cursorconsole|cursor-console|computeConsolePosition|consoleGraceMs" entrypoints test || echo CLEAN
bun run check
bun test --coverage
```

## Success Criteria

- No dead code, no stale references outside historical docs/specs, gate green at 100% coverage
