# Task 004: Content wiring test

**depends-on**: (none)

## Description

Update `test/content/page-lifecycle.test.ts` and `test/content/ui-rendering.test.ts`
to expect the single rail surface and the new test hooks. These suites currently pass
against console+dock; after this task they fail (Red) until 004-impl rewires index.ts.

## Execution Context

**Task Number**: 004 of 005 (test half)
**Phase**: Integration
**Prerequisites**: none technically — but this task turns two currently-green suites
Red until 004-impl lands, so in a shared/concurrent checkout schedule it immediately
before 004-impl (or run the pair in an isolated worktree).

## BDD Scenario

```gherkin
Scenario: Tweet and profile pages mount exactly one surface
  Given a tweet detail or profile URL
  When the content script initializes
  Then exactly one element with data-xb-surface "reply-rail" exists
  And no element with data-xb-surface "cursor-console" exists

Scenario: Timeline pages mount nothing
  Given an x.com timeline URL
  When checkPageAndAddButton runs
  Then no rail element exists

Scenario: SPA navigation tears down and re-creates the rail
  Given the rail is mounted on a tweet page
  When the URL changes to a timeline and back
  Then the old rail is destroyed and a fresh one mounted

Scenario: Test hooks expose the rail
  Given __XB_TEST__ is set
  Then __xblockerTestHooks.getRail() returns the live ReplyRail
  And computeRailY and railTimings (DWELL_MS, COLLAPSE_GRACE_MS) are exposed
  And getCursorConsole/getDock/computeConsolePosition/consoleGraceMs are gone

Scenario: Global listeners route to the rail
  Given a mounted rail
  When document-level mousemove, scroll, and keydown events fire
  Then they are forwarded to the rail handlers exactly once each
```

**Spec Source**: `docs/superpowers/specs/2026-06-12-reply-rail-design.md` § Architecture

## Files to Modify/Create

- Modify: `test/content/page-lifecycle.test.ts`
- Modify: `test/content/ui-rendering.test.ts`

(`test/helpers/content-hooks.ts` is owned by task-002-rail-state-test; if this task
needs helper changes, coordinate there rather than editing the file here.)

## Steps

### Step 1: Update expectations (Red)
- Replace `getDock`/`getCursorConsole` usages with `getRail`; update surface selectors
- **Verification**: both suites FAIL against the current index.ts

## Verification Commands

```bash
bun test test/content/page-lifecycle.test.ts test/content/ui-rendering.test.ts  # must FAIL
```

## Success Criteria

- Suites describe the post-migration wiring only; no lingering dock/console hook names
