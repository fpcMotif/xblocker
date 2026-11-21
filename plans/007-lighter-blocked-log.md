# Plan 007: The Blocked log keeps slim rows and skips redundant re-renders

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- entrypoints/options/panes/blocked-log.ts entrypoints/options/virtual-list.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. Plan 006 may have changed the
> two-line header comment of `virtual-list.ts`; that difference is expected.
> Any other mismatch with the excerpts is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plans 003 and 005 make the pane's storage reads cheaper, but this plan does not need them)
- **Category**: perf
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

The Blocked log keeps every full account object in memory, lower-cases every handle again on each search pass, and rebuilds all visible rows on every scroll event even when the visible window did not move. This plan stores a slim row per account with a pre-lowercased handle and makes the virtual list ignore scroll events that do not change the window. Filters, sorting, export content, keyboard navigation, and the row markup stay unchanged.

## Why this matters

Each account object carries its whole action history, and the pane holds all of them for as long as it is open, though it shows four fields. Each search pass allocates one throwaway lower-case string per account. Each scroll event, which fires many times per frame, discards and rebuilds about 36 rows. With tens of thousands of accounts these three costs make search and scrolling slow and memory-heavy. After this plan the pane holds six small fields per account, search allocates nothing per row, and a scroll inside the same window does no DOM work.

## Current state

- `entrypoints/options/panes/blocked-log.ts` — the Blocked log pane (458 lines).
- `entrypoints/options/virtual-list.ts` — the fixed-row-height virtual list (108 lines), also used by other panes.
- Tests: `test/options/blocked-log.test.ts`, `test/options/virtual-list.test.ts`.

`entrypoints/options/panes/blocked-log.ts:74-79` today:

```ts
type Row = {
  account: BlockedAccount;
  action: "block" | "mute";
  source: RowSource;
  sync: RowSyncStatus;
};
```

`entrypoints/options/panes/blocked-log.ts:113-120` today:

```ts
  const rows: Row[] = accounts
    .map((account) => ({
      account,
      action: primaryActionKind(account),
      source: primaryActionSource(account),
      sync: computeSyncStatus(account.key, pendingKeys, cloudEnabled),
    }))
    .toSorted((a, b) => b.account.lastActionAt - a.account.lastActionAt);
```

Other uses of `row.account` in the file:

- `:237-243` export: `handle: row.account.handle`, `lastActionAt: row.account.lastActionAt`
- `:291` `handleCell.textContent = `@${row.account.handle}`;`
- `:311-312` `formatRelativeShort(now() - row.account.lastActionAt)` and `new Date(row.account.lastActionAt).toLocaleString()`
- `:419` `if (searchQuery && !row.account.handle.toLowerCase().includes(searchQuery)) return false;`

`searchQuery` is already lower-cased where it is set (`:438`: `searchQuery = searchInput.value.trim().toLowerCase();`).

`entrypoints/options/virtual-list.ts:58-89` today:

```ts
  function render(): void {
    // Row elements are rebuilt from scratch below (replaceChildren), so a plain element
    // reference can't survive the rebuild. Capture the focused row's *identity* — its
    // vl-index — beforehand, then look it up again afterward so roving-tabindex focus
    // isn't dropped to <body> just because a scroll tick re-rendered the window it's in.
    const activeElement = document.activeElement;
    const focusedIndex =
      activeElement instanceof HTMLElement && rowsHost.contains(activeElement)
        ? activeElement.dataset.vlIndex
        : undefined;

    const { start, end } = windowBounds();
    topSpacer.style.height = `${start * rowHeight}px`;
    bottomSpacer.style.height = `${Math.max(0, (items.length - end) * rowHeight)}px`;

    const rows: HTMLElement[] = [];
    for (let index = start; index < end; index++) {
      const item = items[index];
      if (item === undefined) continue;
      const row = renderRow(item, index);
      row.dataset.vlIndex = String(index);
      rows.push(row);
    }
    rowsHost.replaceChildren(...rows);

    if (focusedIndex !== undefined) {
      rowsHost.querySelector<HTMLElement>(`[data-vl-index="${focusedIndex}"]`)?.focus();
    }
  }

  const onScroll = () => render();
  container.addEventListener("scroll", onScroll);
```

A constraint that shapes step 2: callers rely on `render()` and `setItems()` always rebuilding rows. `blocked-log.ts:410` calls `virtualList.setItems(filtered)` with the same array after changing `focusedIndex`, so each row's `tabIndex` is recomputed. Only the scroll handler may skip work.

Repo conventions that bind this work:

- Keep every existing comment exactly as written. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work. A comment may leave only together with the code it describes.
- Do not add lint suppressions or `as` type assertions.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test test/options/blocked-log.test.ts test/options/virtual-list.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `entrypoints/options/panes/blocked-log.ts`
- `entrypoints/options/virtual-list.ts`
- `test/options/blocked-log.test.ts`
- `test/options/virtual-list.test.ts`

**Out of scope** (do NOT touch):

- `packages/storage/**` — store reads are plan 003's and plan 005's work.
- `entrypoints/options/download.ts` and the export file format.
- Any `*.stylex.ts` file and the row markup (elements, classes, roles, `title` texts).
- `entrypoints/options/panes/whitelist.ts`.

## Git workflow

- Branch: `advisor/007-lighter-blocked-log`
- One commit per step. Conventional style, for example `perf(options): keep slim rows in the blocked log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Slim the row

1. Change `Row` to:

```ts
type Row = {
  handle: string;
  handleLower: string;
  lastActionAt: number;
  action: "block" | "mute";
  source: RowSource;
  sync: RowSyncStatus;
};
```

2. Build rows with one `map` that copies `account.handle`, `account.handle.toLowerCase()`, `account.lastActionAt`, and the three computed fields. Sort by `lastActionAt` descending, as today. Use `.sort` on the freshly mapped array (it is a new array, so sorting in place is safe).
3. Replace each `row.account.handle` with `row.handle` and each `row.account.lastActionAt` with `row.lastActionAt`.
4. The search check becomes `if (searchQuery && !row.handleLower.includes(searchQuery)) return false;`.
5. Remove the `BlockedAccount` type import if it is now unused in the file. `primaryActionKind` and `primaryActionSource` still take a `BlockedAccount`; keep their signatures.

Add a test to `test/options/blocked-log.test.ts`: an account stored with a mixed-case handle (`"MixedCase"`) is found by the query `mixedc`, and the exported JSON still contains `handle: "MixedCase"`.

**Verify**: `bun test test/options/blocked-log.test.ts` → all pass. `bun run typecheck` → exit 0.

### Step 2: Skip scroll events that do not move the window

In `entrypoints/options/virtual-list.ts`:

1. Keep two closure variables, `renderedStart` and `renderedEnd`, set at the end of `render()` to the `start` and `end` it used.
2. Change the scroll handler to compute `windowBounds()` first and call `render()` only when `start !== renderedStart || end !== renderedEnd`.
3. Leave `render()` and `setItems()` unconditional.

Add tests to `test/options/virtual-list.test.ts`:

- A `scroll` event with unchanged `scrollTop` does not call `renderRow` again (count calls with a counter inside the `renderRow` passed to the list).
- A `scroll` event after `scrollTop` moved past the overscan band calls `renderRow` and renders the new window.
- `render()` called directly still re-renders with an unchanged window.
- `setItems()` with the same array still re-renders.

**Verify**: `bun test test/options/virtual-list.test.ts test/options/blocked-log.test.ts` → all pass.

### Step 3: Make the row-height constant match the row style

`entrypoints/options/panes/blocked-log.ts:14` says `export const BLOCKED_LOG_ROW_HEIGHT = 36;`. The rows use `styles.tableRow`, and `entrypoints/options/options-table.stylex.ts:142-148` sets that style's `height: 40`. The virtual list computes its spacers and its visible window from the constant, so with 36 the scroll position drifts 4 px per row from the rows actually drawn. This was found by reading the code and was not confirmed in a browser.

1. Confirm that `tableRow` still sets `height: 40` and that nothing else sets a height for `.xb-opt-table-row` (`rg -n "xb-opt-table-row" entrypoints/options`).
2. Change the constant to `40`.
3. Run the pane tests. They should use the exported constant; if a test hard-codes 36 for the Blocked log, change it to use `BLOCKED_LOG_ROW_HEIGHT`.

**Verify**: `bun test test/options/blocked-log.test.ts` → all pass. `rg -n "BLOCKED_LOG_ROW_HEIGHT = 40" entrypoints/options/panes/blocked-log.ts` → one match.

### Step 4: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- One pane test (step 1) and four virtual-list tests (step 2).
- Structural pattern: existing tests in `test/options/virtual-list.test.ts`, which pass a fixed `getViewportHeight` and dispatch `scroll` on the container.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the five new tests present and passing
- [ ] `rg -n "row\.account" entrypoints/options/panes/blocked-log.ts` returns no matches
- [ ] `rg -n "toLowerCase\(\)\.includes" entrypoints/options/panes/blocked-log.ts` returns no matches
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The quoted code does not match the live files beyond the expected header-comment difference.
- An existing keyboard-navigation test (`j`/`k`/arrow keys) fails after step 2. That means a caller depends on the scroll handler re-rendering; report which one.
- A consumer outside this file reads `row.account`.
- In step 3, `tableRow` does not set `height: 40`, or another rule sets a different height for the Blocked log's rows. Report what you find and leave the constant unchanged.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- `whenCell.title` still builds a locale date string for every rendered row. With about 36 rows per render this is small; a shared `Intl.DateTimeFormat` is a possible follow-up.
- The pane still takes a snapshot at mount and does not update while open.
- If a future column needs another account field, add it to `Row`. Do not put the whole account back.
- Reviewers: scroll slowly in a long log and confirm keyboard focus is kept and rows do not flicker.
- The owner should scroll to the end of a log with several thousand rows in a real browser and confirm the last row lines up with the bottom of the list. That is the visible check for step 3.
