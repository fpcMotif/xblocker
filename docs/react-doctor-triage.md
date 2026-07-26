# React Doctor triage

Date: 2026-07-26

Tool: `react-doctor` 0.9.1

Baseline: 81/100, 14 warnings

Scope: WXT MV3 extension. No React project detected, so React-only rules were gated off.

## Outcome

- 5 true positives: fix in this PR.
- 9 false positives: keep serial or retain required files/dependency.
- 0 need human review.

## Findings

| # | Finding | Triage | Confidence | Evidence / action |
| -: | --- | --- | --- | --- |
| 1 | `convex/_generated/api.js`: unused file | False positive | High | Convex-generated contract. Committed so CI works without a Convex login. Codegen recreates it. |
| 2 | `convex/_generated/server.js`: unused file | False positive | High | Runtime import target for `convex/blocked.ts`. Generated and committed by policy. |
| 3 | `convex/blocked.ts`: unused file | False positive | High | Convex discovers backend functions by file path. Client calls `blocked:*` through function references. |
| 4 | `convex/blocked.ts:171`: await in loop | False positive | High | Actions may hit the same ledger row. Ordered writes prevent lost rollups. Parity tests require batch order. |
| 5 | `convex/blocked.ts:213`: await in loop | True positive | High | Account deletes are independent. Fan out with `Promise.all`. |
| 6 | `convex/blocked.ts:221`: await in loop | True positive | High | Action deletes are independent. Fan out with `Promise.all`. |
| 7 | `convex/schema.ts`: unused file | False positive | High | Convex discovers the schema by its reserved filename. |
| 8 | `entrypoints/content/actions.ts:30`: unused `DEFAULT_MAX_REPLIES` export | True positive | High | No importer uses this compatibility re-export. Remove it; keep the source constant in `lib/settings.ts`. |
| 9 | `entrypoints/content/actions.ts:30`: unused `MAX_REPLIES_LIMIT` export | True positive | High | No importer uses this compatibility re-export. Remove it; options imports the source constant directly. |
| 10 | `entrypoints/content/actions.ts:181`: await in loop | False positive | High | X actions are intentionally ordered and rate-paced by 250 ms. Progress also depends on order. |
| 11 | `entrypoints/lib/convex-sync.ts:84`: await in loop | False positive | High | The first missing-function result selects the fallback for later batches. Batches may touch the same ledger row. |
| 12 | `entrypoints/lib/convex-sync.ts:93`: await in loop | False positive | High | Compatibility fallback preserves action order and a clean accepted prefix on failure. |
| 13 | `package.json`: unused `oxlint-tsgolint` | False positive | High | `lint` uses `oxlint --type-aware`; Oxc requires this package for type-aware linting. |
| 14 | `test/helpers/cloud-adapter-fake.ts`: unused file | True positive | High | No test imports it. Delete it. |

## Verification

- Untouched `origin/main`: `bun run check` passed.
- Baseline: 633 tests, 100% covered lines/functions, production build passed.
- Focused tests passed after each fix.
- Root and Convex TypeScript checks passed.
- Final `bun run check`: 633 tests, 100% covered lines/functions, production build passed.
- Final React Doctor: 84/100, 8 warnings. All 5 true positives are gone; the 8 remaining warnings are the triaged ordered loops and Convex file-entrypoint false positives.

Run the build and React Doctor serially. A concurrent scan can inspect WXT's generated
`.output/` bundle mid-build and report generated-code findings that do not exist in source.
