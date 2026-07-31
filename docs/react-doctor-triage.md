# React Doctor triage

Date: 2026-07-26 (scan) / 2026-08-01 (re-triaged and re-verified against `main`)

Tool: `react-doctor` 0.9.1

Baseline: 81/100, 14 warnings

Scope: WXT MV3 extension. No React project detected, so React-only rules were gated off.

Provenance: originally raised as PR #38 (`codex/react-doctor-fixes`), which was closed while
conflicting. Every finding was re-triaged against current `main` before being re-applied. Two of
the original PR's five "true positives" were **downgraded to false positives** on review — see
rows 5 and 6.

## Outcome

- 3 true positives: fixed.
- 11 false positives: keep serial, or retain the required file/dependency.
- 0 need human review.

## Findings

| # | Finding | Triage | Confidence | Evidence / action |
| -: | --- | --- | --- | --- |
| 1 | `convex/_generated/api.js`: unused file | False positive | High | Convex-generated contract. Committed so CI works without a Convex login. Codegen recreates it. |
| 2 | `convex/_generated/server.js`: unused file | False positive | High | Runtime import target for `convex/blocked.ts`. Generated and committed by policy. |
| 3 | `convex/blocked.ts`: unused file | False positive | High | Convex discovers backend functions by file path. Client calls `blocked:*` through function references. |
| 4 | `convex/blocked.ts:171`: await in loop | False positive | High | `applyRecordAction` does a read-modify-write on a shared account row (`byXid` → `applyAccountRollup` → `ctx.db.patch`, lines 81–139). Ordered writes prevent lost rollups. **This loop must stay serial.** |
| 5 | `convex/blocked.ts:213`: await in loop | False positive | High | Downgraded from the original PR's "fix with `Promise.all`". See *Why rows 5 and 6 were downgraded*. |
| 6 | `convex/blocked.ts:221`: await in loop | False positive | High | Same as row 5. |
| 7 | `convex/schema.ts`: unused file | False positive | High | Convex discovers the schema by its reserved filename. |
| 8 | `entrypoints/content/actions.ts:30`: unused `DEFAULT_MAX_REPLIES` re-export | True positive | High | No importer used this compatibility re-export. Removed; the source constant stays in `packages/storage/settings.ts`. |
| 9 | `entrypoints/content/actions.ts:30`: unused `MAX_REPLIES_LIMIT` re-export | True positive | High | No importer used this compatibility re-export. `entrypoints/options/panes/general.ts:8` imports the source constant directly. |
| 10 | `entrypoints/content/actions.ts:176`: await in loop | False positive | High | X actions are intentionally ordered and rate-paced by `DIRECT_ACTION_DELAY_MS` (250 ms). Progress reporting also depends on order. |
| 11 | `packages/sync/lib/convex-sync.ts:88`: await in loop | False positive | High | The first missing-function result sets `batchUnsupported`, which selects the fallback for later batches. Batches may touch the same ledger row. |
| 12 | `packages/sync/lib/convex-sync.ts:97`: await in loop | False positive | High | Compatibility fallback preserves action order and a clean accepted prefix on failure. |
| 13 | `package.json`: unused `oxlint-tsgolint` | False positive | High | `lint` uses `oxlint --type-aware`; Oxc requires this package for type-aware linting. |
| 14 | `test/helpers/cloud-adapter-fake.ts`: unused file | True positive | High | Nothing imported it. Its own header claimed the popup sync-row and options cloud-pane suites shared it, but both define their own inline `CloudAdapter` and inject it via `loadAdapter`. Deleted. |

## Why rows 5 and 6 were downgraded

PR #38 replaced the two `clearOwner` delete loops with `await Promise.all(rows.map(…))`. That
change was reverted rather than absorbed, for four reasons:

1. **The repo has already opted out of this rule.** `.oxlintrc.json:11` sets
   `"no-await-in-loop": "off"`, and `.oxlintrc.json:33` lists `convex/**` under
   `ignorePatterns`. A third-party heuristic should not override settled local policy.
2. **There is no round-trip to parallelize.** Convex buffers all writes in the transaction and
   commits once when the mutation returns, so the deletes are not per-row network calls. The
   vendored SDK documents bulk delete as a serial loop
   (`node_modules/convex/dist/*-types/server/database.d.ts`, "Delete multiple documents").
3. **It creates a foot-gun 40 lines from an order-critical loop.** Row 4's loop *must* stay
   serial. Two visually similar write loops in opposite styles, with no comment explaining the
   difference, invites a future "make it consistent" pass that would corrupt the rollup arithmetic.
4. **Nothing here would catch a mistake.** `tsconfig.json:14` excludes `convex` from
   `tsgo --noEmit`, `.oxlintrc.json` ignores `convex/**`, the `format:check` globs skip
   `convex/**`, and no test imports the module — so CI's `bun run check` never sees this file.

The real scaling risk in `clearOwner` is unrelated to loop style: it `.collect()`s every
`blockedAccounts` and `blockActions` row and deletes them in one transaction, and `blockActions`
grows without bound. A heavy owner can exceed Convex's per-transaction write limit and the wipe
fails outright — identically before and after `Promise.all`. The fix is paginated deletion across
scheduled mutations, which is tracked separately.

## Verification

- Root TypeScript check: `tsgo --noEmit` clean.
- Convex TypeScript check: `tsgo --noEmit -p convex/tsconfig.json` clean (run manually — CI does
  not cover `convex/`, see reason 4 above).
- Full `bun run check` on `main` with the absorbed changes (2026-08-01): typecheck, `oxlint
  --type-aware --deny-warnings`, `depcruise` boundaries (71 modules, 0 violations), `oxfmt
  --check`, **642 tests passing across 41 files at 100% covered lines/functions**, and a clean
  production build.

Run the build and React Doctor serially. A concurrent scan can inspect WXT's generated
`.output/` bundle mid-build and report generated-code findings that do not exist in source.
