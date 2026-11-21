# Plan 012: Type-check, lint, and format with Bun's built-in tools

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1281fbf..HEAD -- package.json bunfig.toml .oxlintrc.json .oxfmtrc.json packages/storage/blocked-store.ts`
> This plan was written against commit `1281fbf` on branch
> `feat/options-page-polish`. Expect no output apart from `plans/` files. Any
> other difference is a STOP condition.

## Status

- **Priority**: P0 (every other plan's gates run `bun run typecheck`, which fails today)
- **Effort**: M
- **Risk**: MED
- **Depends on**: none. Run it before plans 002–011.
- **Category**: dx
- **Planned at**: commit `1281fbf`, 2026-11-18

## At a glance

The repo type-checks with tsgo, lints with oxlint and oxlint-tsgolint, and formats with oxfmt. Bun 1.4.5 ships all three jobs: `bun check`, `bun lint --type-aware`, and `bun fmt`. This plan moves the scripts to those commands, moves both tool configs into `bunfig.toml`, turns on Bun's own `bun/*` lint rules, fixes what they report, fixes the one type error that blocks `bun run typecheck` today, and removes the four packages Bun replaces. The script names (`typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `check`) stay the same, so the other plans' commands keep working. `dependency-cruiser` stays, because Bun has no boundary checker.

## Why this matters

The owner asked for lint, type check, and format to run the Bun-native way, type-aware, with Bun's own rules on. It also removes four dev dependencies. Measured on this repo (`bun 1.4.5`, macOS):

| Job | Today | Bun |
|---|---|---|
| Type check | `tsgo --noEmit`: 1 error | `bun check`: the same 1 error, 109 files in 89 ms |
| Type check, Convex | not run by any script | `bun check -p convex`: 0 errors, 6 files in 22 ms |
| Lint | `oxlint --type-aware`: 0 findings | `bun lint --type-aware` with `.oxlintrc.json`: 2 findings, 0.13 s |
| Format | `oxfmt --check`: clean | `bun fmt --check` on the same file list: clean, 111 files in 17 ms |

`bun check` embeds TypeScript 7.0.2 (`bun -p process.versions.typescript`). The `typescript` dev dependency is `"next"`, which installed 6.0.3, so the editor and the checker disagree today.

## Current state

`package.json` scripts today:

```json
"typecheck": "tsgo --noEmit",
"lint": "oxlint --type-aware --deny-warnings .",
"lint:fix": "oxlint --type-aware --fix .",
"lint:boundaries": "depcruise entrypoints packages convex",
"format": "oxfmt --write package.json tsconfig.json wxt.config.ts bts.jsonc .oxlintrc.json .oxfmtrc.json bunfig.toml README.md \"entrypoints/**/*.ts\" \"test/**/*.ts\" \"packages/**/*.ts\" \"scripts/**/*.ts\"",
"format:check": "oxfmt --check package.json tsconfig.json wxt.config.ts bts.jsonc .oxlintrc.json .oxfmtrc.json bunfig.toml README.md \"entrypoints/**/*.ts\" \"test/**/*.ts\" \"packages/**/*.ts\" \"scripts/**/*.ts\"",
"check": "bun run typecheck && bun run lint && bun run lint:boundaries && bun run format:check && bun run design:contrast && bun test && bun run build",
```

Dev dependencies that Bun replaces: `"@typescript/native-preview": "^7.0.0-dev.20260707.2"`, `"oxfmt": "^0.72.0"`, `"oxlint": "^1.87.0"`, `"oxlint-tsgolint": "^7.0.2003"`. Also `"typescript": "next"`.

`.oxlintrc.json` today (the whole file):

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "import", "promise"],
  "categories": { "correctness": "error", "suspicious": "error", "perf": "warn" },
  "rules": {
    "no-async-promise-executor": "error", "no-await-in-loop": "off", "no-console": "off",
    "no-empty": "error", "no-fallthrough": "error", "no-underscore-dangle": "off",
    "no-prototype-builtins": "error", "no-self-assign": "error", "no-unused-vars": "error",
    "prefer-const": "error", "unicorn/consistent-function-scoping": "off", "use-isnan": "error"
  },
  "env": { "browser": true, "builtin": true, "es2024": true, "webextensions": true },
  "ignorePatterns": [".claude/**", ".output/**", ".wxt/**", "convex/**", "coverage/**", "node_modules/**"]
}
```

`.oxfmtrc.json` today: `{ "ignorePatterns": [".output/**", ".wxt/**", "coverage/**", "node_modules/**"] }`.

`bunfig.toml` today has `[test]`, `[env]`, and `[install]` sections and no `[lint]` or `[fmt]`.

The type error, `packages/storage/blocked-store.ts:126`:

```ts
    chrome.storage.local.get(key, (result?: { [storageKey: string]: T | undefined }) => {
```

`error TS2345: Argument of type 'string' is not assignable to parameter of type 'never[] | Partial<{ [storageKey: string]: T | undefined; } | undefined> | null'.` The optional parameter (`result?:`) makes TypeScript pick the wrong `get` overload. `packages/storage/chrome-storage.ts:62` types the same kind of callback as `(result: Record<string, unknown> | undefined)` and passes.

### Facts the advisor confirmed before writing this plan

- `bun lint` reads `bunfig.toml`'s `[lint]` section when no `.oxlintrc.json` exists. The section accepts `typeAware`, `plugins`, `ignorePatterns`, `[lint.categories]`, `[lint.rules]`, and `[[lint.overrides]]` (`files` plus inline `rules`). It rejects unknown keys with an error, for example `error: Unknown key "env" in [lint]`. There is no `env` key.
- With the `[lint]` section in step 2 below plus two `bun/*` rules, `bun lint --doctor` reported `Using bunfig.toml ([lint])` and `175 rules run natively`. That is the 148 rules plus 25 type-aware rules that `.oxlintrc.json` gives, plus the two `bun/*` rules. Without them, expect 173.
- `"bun/*"` can only be set to `"off"`. Each `bun/*` rule must be named to turn it on. Every `bun/*` rule is off by default.
- `bun lint`, `bun fmt`, and `bun check` run the package.json script of the same name when one exists (`lint`, `fmt`, `check`). Pass `--no-script` to run the built-in tool when you call it by hand. The migration guide puts `bun lint ...` inside the `lint` script itself.
- With all 27 option-free `bun/*` rules on, Bun reports 79 findings. They are listed in step 3.

Repo conventions that bind this work:

- Keep every existing comment exactly as written, including YAML and TOML comments. Do not add comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. A comment may leave only together with the code it describes. An `oxlint-disable` line counts as a comment.
- Do not add lint suppressions (`eslint-disable`, `oxlint-disable`, `@ts-expect-error`) and no `as` type assertions. Fix the code.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every line and branch you change still needs a test.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Type check | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Lint config report | `bun lint --doctor --no-script` | names `bunfig.toml ([lint])` |
| Format check | `bun run format:check` | exit 0 |
| Format config report | `bun fmt --doctor --no-script` | names `bunfig.toml` |
| Boundaries | `bun run lint:boundaries` | exit 0 |
| Full tests | `bun test` | all pass, coverage threshold met |
| Build | `bun run build` | exit 0 |

## Scope

**In scope**:

- `package.json`, `bun.lock`, `bunfig.toml`
- `.oxlintrc.json`, `.oxfmtrc.json` (both deleted)
- `packages/storage/blocked-store.ts` (line 126 only, plus the step 3 spread fixes)
- The files named in step 3, only at the reported lines, and their tests if coverage needs it

**Out of scope** (do NOT touch):

- `.github/workflows/check.yml`. It runs `bun run check`, which keeps working. Its header comment names tsgo, oxlint, and oxfmt; that is stale documentation for the owner, not for you.
- `README.md`, `SPEC.md`, and `docs/**`. They mention tsgo in places. Report the stale lines; do not edit them.
- `.dependency-cruiser*` and the `lint:boundaries` script.
- `convex/**` source. `bun check -p convex` must pass without changes there.

## Git workflow

- Branch: `advisor/012-bun-native-toolchain`, created from `1281fbf` or from the branch tip your dispatcher names.
- One commit per step. Conventional style, for example `build: type-check with bun check`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the type error and type-check with `bun check`

1. In `packages/storage/blocked-store.ts:126`, change the callback parameter from `result?: { [storageKey: string]: T | undefined }` to `result: { [storageKey: string]: T | undefined } | undefined`. Keep the body, including the `result === undefined` rejection, unchanged.
2. Set `"typecheck": "bun check --no-script && bun check --no-script -p convex"`.
3. Replace `"typescript": "next"` with the version `bun check` embeds: `bun add -d typescript@$(bun -p process.versions.typescript)` (7.0.2 when this plan was written). This keeps the editor's TypeScript equal to the checker's.
4. `bun remove @typescript/native-preview`.

**Verify**: `bun run typecheck` → exit 0, and both runs print `No type errors`. `bun test` → all pass. `bun run build` → exit 0. `rg -n "tsgo" package.json` → no matches.

### Step 2: Move the lint config into `bunfig.toml` and lint with `bun lint`

1. Append this section to `bunfig.toml`, with no comments:

```toml
[lint]
typeAware = true
plugins = ["typescript", "unicorn", "oxc", "import", "promise"]
ignorePatterns = [".claude/", ".output/", ".wxt/", "convex/", "coverage/", "node_modules/"]

[lint.categories]
correctness = "error"
suspicious = "error"
perf = "warn"

[lint.rules]
"no-async-promise-executor" = "error"
"no-await-in-loop" = "off"
"no-console" = "off"
"no-empty" = "error"
"no-fallthrough" = "error"
"no-underscore-dangle" = "off"
"no-prototype-builtins" = "error"
"no-self-assign" = "error"
"no-unused-vars" = "error"
"prefer-const" = "error"
"unicorn/consistent-function-scoping" = "off"
"use-isnan" = "error"
```

2. Delete `.oxlintrc.json`.
3. Set the scripts: `"lint": "bun lint --max-warnings 0"` and `"lint:fix": "bun lint --fix"`. `bun lint` given no paths lints the project, as `oxlint .` did. If `bun run lint` runs the script recursively or prints its own usage, use `bun lint --no-script --max-warnings 0` instead.
4. `bun remove oxlint oxlint-tsgolint`.
5. Run `bun run lint`. Before this step, `bun lint --type-aware` reported two findings, both `typescript(no-unsafe-type-assertion)` at `test/live-number.test.ts:254` and `:259`. Both lines already carry an `oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ...` comment that oxlint honored. If these two findings still appear, rewrite those two assignments without an `as` assertion (for example with `spyOn(window, "setTimeout").mockImplementation(...)` from `bun:test`), and remove each `oxlint-disable-next-line` comment together with the cast it describes. Any other finding is a STOP condition.

**Verify**: `bun lint --doctor --no-script` → prints `Using bunfig.toml ([lint])` and at least `173 rules run natively`, and lists neither `oxlint` nor `oxlint-tsgolint` under "Still needed". `bun run lint` → exit 0. `bun test` → all pass.

### Step 3: Turn on Bun's own rules and fix what they report

1. Add these lines to `[lint.rules]` in `bunfig.toml`. They are all 29 `bun/*` rules. Three stay off for the reason given in the "Rule decisions" table below.

```toml
"bun/axios-no-unbounded-requests" = "error"
"bun/consistent-directive-prefix" = "off"
"bun/fast-check-no-unseeded-random" = "error"
"bun/format" = "off"
"bun/jsx-no-forbidden-nesting" = "error"
"bun/no-array-just-to-count" = "error"
"bun/no-cast-to-brand" = "error"
"bun/no-console-window-flash" = "error"
"bun/no-cwd-dependent-path" = "error"
"bun/no-eager-dynamic-import" = "error"
"bun/no-eager-native-addon" = "error"
"bun/no-env-at-module-scope" = "error"
"bun/no-literal-temp-dir" = "error"
"bun/no-negative-repeat-count" = "error"
"bun/no-redundant-catch-type" = "error"
"bun/no-restricted-text" = "off"
"bun/no-side-effects-on-import" = "error"
"bun/no-unhandled-emitter-errors" = "error"
"bun/no-unportable-commands" = "error"
"bun/no-useless-spread-fallback" = "error"
"bun/prefer-builtin-sleep" = "error"
"bun/prefer-local-module" = "error"
"bun/prefer-timeout-signal" = "error"
"bun/prefer-url-for-sibling-files" = "error"
"bun/react-no-latest-value-ref" = "error"
"bun/react-no-local-render-helpers" = "error"
"bun/react-no-namespace-hooks" = "error"
"bun/react-prefer-updater-function" = "error"
"bun/zod-prefer-lazy-schema" = "error"
```

2. Append these overrides after `[lint.rules]`. Each one scopes a rule away from code where its premise does not hold.

```toml
[[lint.overrides]]
files = ["entrypoints/**", "packages/*/*.ts", "packages/*/lib/**"]
rules = { "bun/prefer-builtin-sleep" = "off" }

[[lint.overrides]]
files = ["entrypoints/*/main.ts", "entrypoints/content/index.ts", "entrypoints/background.ts", "scripts/**", "tools/**", "test/**"]
rules = { "bun/no-side-effects-on-import" = "off" }

[[lint.overrides]]
files = ["test/**"]
rules = { "bun/no-eager-dynamic-import" = "off" }

[[lint.overrides]]
files = ["wxt.config.ts"]
rules = { "bun/no-env-at-module-scope" = "off" }
```

#### Rule decisions

| Rule | Decision | Reason |
|---|---|---|
| `bun/consistent-directive-prefix` | off | It asks to rename 25 `oxlint-disable` comments to `eslint-disable`. Bun honors both prefixes, and the doc-lock hook forbids comment edits. |
| `bun/format` | off | `bun fmt --check` already runs in `format:check`. |
| `bun/no-restricted-text` | off | It needs a list of banned text, and the owner has given none. |
| `bun/prefer-builtin-sleep` | off in extension code | `entrypoints/**` and the non-test `packages/**` files run in the browser, where `Bun.sleep` and `node:timers/promises` do not exist. It stays on for tests, scripts, and tools. |
| `bun/no-side-effects-on-import` | off in entry points, scripts, tools, tests | An entry point, a CLI script, and a test preload exist to run when loaded. It stays on for every other module. |
| `bun/no-eager-dynamic-import` | off in `test/**` | `test/helpers/content-hooks.ts:6` sets a global, then imports the content script. The order is the point. |
| `bun/no-env-at-module-scope` | off in `wxt.config.ts` | WXT evaluates the config once per build. |

3. Fix the remaining findings. These are the findings the advisor saw that the overrides do not cover:
   - `bun/no-useless-spread-fallback`, 13 sites: `entrypoints/content/actions.ts:163`, `entrypoints/content/x-api.ts:263`, `entrypoints/options/panes/blocked-log.ts:373`, 8 in `packages/storage/` (6 in `blocked-merge.ts`), and 2 in `packages/sync/`. Each is a spread like `...(cond ? { xUserId: id } : {})`. Change the `: {}` branch to `: undefined`. Keep the ternary; `&&` would spread a string in some of these.
   - `bun/prefer-builtin-sleep` in tests, 10 sites in `test/**` and `packages/sync/tests/background-sync.test.ts:42`. Replace `new Promise((resolve) => setTimeout(resolve, ms))` with `Bun.sleep(ms)`. If a test then fails because it uses fake timers or happy-dom timers, restore that one site and add its file to the `bun/prefer-builtin-sleep` override instead. List each such file in your report.
   - `bun/no-console-window-flash`, 2 sites: `tools/qa/browser.mjs:51` and `tools/qa/self-check.mjs:53`. Add `windowsHide: true` to the spawn options.
   - `bun/prefer-url-for-sibling-files`, `tools/design/fixtures.ts:9`. Build the path from `new URL("...", import.meta.url)` as the message says.
   - `bun/no-cwd-dependent-path` at `scripts/pack-crx.ts:23` and `bun/no-env-at-module-scope` at `scripts/pack-crx.ts:24`. Move `OUT_DIR` and `KEY_PATH` into the function that uses them. Resolve `.output` and the default `.keys/crx.pem` from the repository root (`resolve(import.meta.dirname, "..", ...)`). Keep reading `process.env.XBLOCKER_CRX_KEY` as given, relative to the working directory, as today.

**Verify**: `bun run lint` → exit 0. `bun lint --doctor --no-script` → at least 199 rules run natively (173 plus the 26 `bun/*` rules that are on). `bun test` → all pass, coverage threshold met. `bun run build` → exit 0.

### Step 4: Format with `bun fmt`

1. Append to `bunfig.toml`:

```toml
[fmt]
ignorePatterns = [".output/", ".wxt/", "coverage/", "node_modules/"]
```

2. Delete `.oxfmtrc.json`.
3. Set `"format"` to `bun fmt` and `"format:check"` to `bun fmt --check`, each followed by the same file list as today minus `.oxlintrc.json` and `.oxfmtrc.json`: `package.json tsconfig.json wxt.config.ts bts.jsonc bunfig.toml README.md "entrypoints/**/*.ts" "test/**/*.ts" "packages/**/*.ts" "scripts/**/*.ts"`. Keep the explicit list: an unscoped `bun fmt --check` also parses `docs/**/*.html` and fails on `docs/reviews/0614b-architecture-review-xblocker.html`.
4. `bun remove oxfmt`.
5. Run `bun run format`. Expect no file changes apart from `bunfig.toml` (its new sections may be reformatted). Run `git diff --stat` to confirm.

**Verify**: `bun fmt --doctor --no-script` → names `bunfig.toml`, not `.oxfmtrc.json`, and lists nothing under "Still needed". `bun run format:check` → exit 0.

### Step 5: Run the full gates

**Verify**:

- `bun run check` → exit 0. It runs typecheck, lint, boundaries, format check, contrast, tests, and build.
- `rg -n "oxlint|oxfmt|tsgo|native-preview" package.json bunfig.toml` → no matches.
- `git ls-files .oxlintrc.json .oxfmtrc.json` → no output.

## Test plan

- No new behavior, so no new tests, except where a step 3 change leaves a line or branch uncovered. Then add the smallest test that covers it, next to the existing tests for that file.
- The gates are the test: `bun run check` must pass end to end.

## Done criteria

- [ ] `bun run check` exits 0
- [ ] `bun lint --doctor --no-script` names `bunfig.toml ([lint])` and reports at least 199 native rules
- [ ] `bun fmt --doctor --no-script` names `bunfig.toml`
- [ ] `package.json` has no `oxlint`, `oxlint-tsgolint`, `oxfmt`, or `@typescript/native-preview`, and `typescript` equals `bun -p process.versions.typescript`
- [ ] `.oxlintrc.json` and `.oxfmtrc.json` are deleted
- [ ] No new `eslint-disable`, `oxlint-disable`, `@ts-expect-error`, or `as` assertion: `git diff 1281fbf..HEAD | rg "^\+.*(eslint-disable|oxlint-disable|ts-expect-error| as [A-Z(])"` → no matches
- [ ] Your report lists every stale tsgo, oxlint, or oxfmt mention left in `README.md`, `SPEC.md`, `docs/**`, and `.github/workflows/check.yml`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `bun --version` is below 1.4.5, or `bun check`, `bun lint`, or `bun fmt` is missing.
- After step 1, `bun check` reports an error other than the one at `blocked-store.ts:126`, or that fix does not clear it without an `as` assertion.
- Installing `typescript@7.x` breaks `bun run build` or `wxt prepare`. Report the error and leave `typescript` at its old version.
- `bun lint --doctor` reports fewer native rules than the numbers in steps 2 and 3, or does not name `bunfig.toml`.
- After step 2, `bun run lint` reports a finding other than the two at `test/live-number.test.ts:254` and `:259`.
- After the step 3 overrides, a finding remains that is not in the step 3 list, or a fix needs a comment change.
- `bun run format` changes any file other than `bunfig.toml`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `bun check` and `bun lint --type-aware` both use the TypeScript bundled with Bun. Upgrading Bun upgrades the checker. After a Bun upgrade, run `bun add -d typescript@$(bun -p process.versions.typescript)` so the editor matches.
- `bun check`, `bun lint`, and `bun fmt` with no flag run the package.json script of the same name when it exists. `check` is the aggregate gate here, so a bare `bun check` runs the whole gate, not just the type checker. Use `bun run typecheck` for types alone.
- CI (`.github/workflows/check.yml`) installs Bun `canary`. The canary ships these commands. Pin Bun 1.4.5 or later once the lockfile allows it.
- `bun/no-restricted-text` can enforce banned words later, for example product names, once the owner has a list.
- Reviewers: check that each override in step 3 matches only the files its reason names.
