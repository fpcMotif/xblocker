# Plan 006: The whitelist table renders only the rows on screen

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f47be65..HEAD -- entrypoints/options/panes/whitelist.ts entrypoints/options/virtual-list.ts test/options/whitelist.test.ts`
> This plan was written against commit `f47be65`, which committed the working-tree
> edits on branch `feat/options-page-polish`. The excerpts under "Current
> state" are the authority. If the live code does not match them, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f47be65` (`c7bf141` plus the then-uncommitted working tree), 2026-11-17

## At a glance

The options page builds one DOM row, button, icon, and click handler for every whitelisted handle, and rebuilds all of them after each search, add, remove, or import. This plan renders only the visible rows through the existing virtual list and searches a pre-lowercased copy of the handles. The table's look, its texts, the confirm-before-remove behavior, and import and export stay unchanged.

## Why this matters

A table that builds a row per item costs time and memory in proportion to the list, on every redraw. With 20,000 handles, each search keystroke (after the debounce) destroys and recreates about 100,000 DOM nodes. The owner asked for search and list management to be much faster and lighter. The repository already has a fixed-row-height virtual list used by the Blocked log. Reusing it makes a redraw cost about 40 rows whatever the list size.

## Current state

- `entrypoints/options/panes/whitelist.ts` — the Whitelist pane (339 lines). `renderWhitelistPane(container)` builds everything.
- `entrypoints/options/virtual-list.ts` — `createVirtualList<T>({ container, rowHeight, renderRow, overscan?, getViewportHeight? })` returning `{ setItems, render, findRowElement, destroy }`. Rows get `data-vl-index`.
- `entrypoints/options/panes/blocked-log.ts:344-394` — `buildTable()`, the exemplar for wiring the virtual list into a table. It uses the same `styles.tableRow` style the whitelist uses.
- `entrypoints/options/options-table.stylex.ts:142-163` — `tableRow` sets `height: 40`. The virtual list needs the real row height, so the whitelist uses 40. (The Blocked log passes `BLOCKED_LOG_ROW_HEIGHT = 36`, which does not match this style; plan 007 corrects that. Do not copy the 36.)
- `entrypoints/options/options-table.stylex.ts:250-254` — `tableScroll: { position: "relative", maxHeight: 560, overflowY: "auto" }`.
- `test/options/whitelist.test.ts` — pane tests; they call `renderWhitelistPane(document.body)`.

`entrypoints/options/panes/whitelist.ts:73-81` today:

```ts
export async function renderWhitelistPane(container: HTMLElement): Promise<PaneHandle> {
  const [whitelist, storedSettings] = await Promise.all([
    getWhitelist(),
    storageGet<unknown>(SETTINGS_KEY),
  ]);
  const confirmRequired = normalizeSettings(storedSettings).confirmDestructiveActions;
  let entries = [...whitelist];
  let searchQuery = "";
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;
```

`entrypoints/options/panes/whitelist.ts:164-205` today:

```ts
  function createRemoveControl(handle: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `${stylex.props(styles.ghostIcon).className} xb-opt-ghost-icon`;
    button.setAttribute("aria-label", `Remove ${handle} from whitelist`);
    button.appendChild(createIcon("cross", 14));

    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    function resetControl(): void {
      if (confirmTimer !== undefined) {
        clearTimeout(confirmTimer);
        confirmTimer = undefined;
      }
      button.dataset.confirming = "false";
      button.replaceChildren(createIcon("cross", 14));
    }

    async function commitRemove(): Promise<void> {
      resetControl();
      await removeFromWhitelist(handle);
      entries = entries.filter((entry) => entry.toLowerCase() !== handle.toLowerCase());
      drawTable();
    }

    button.addEventListener("click", () => {
      if (!confirmRequired || button.dataset.confirming === "true") {
        void commitRemove();
        return;
      }
      button.dataset.confirming = "true";
      button.textContent = "Confirm?";
      confirmTimer = setTimeout(resetControl, WHITELIST_CONFIRM_WINDOW_MS);
    });

    return button;
  }

  function visibleEntries(): string[] {
    if (!searchQuery) return entries;
    const needle = searchQuery.toLowerCase();
    return entries.filter((handle) => handle.toLowerCase().includes(needle));
  }
```

`entrypoints/options/panes/whitelist.ts:240-263` today (the end of `drawTable`):

```ts
    if (visible.length === 0) {
      const noMatches = document.createElement("p");
      noMatches.className = `${stylex.props(styles.fieldCaption).className} xb-opt-field-caption`;
      noMatches.style.padding = "16px";
      noMatches.textContent = `No handles match "${searchQuery}".`;
      table.appendChild(noMatches);
    }

    for (const handle of visible) {
      const row = document.createElement("div");
      row.className = `${stylex.props(styles.tableRow).className} xb-opt-table-row`;
      row.style.gridTemplateColumns = ROW_GRID;
      row.tabIndex = 0;

      const handleCell = document.createElement("span");
      handleCell.className = `${stylex.props(styles.cellHandle).className} xb-opt-cell-handle`;
      handleCell.textContent = `@${handle}`;

      row.append(handleCell, createRemoveControl(handle));
      table.appendChild(row);
    }

    tableArea.replaceChildren(table);
  }
```

`entrypoints/options/panes/whitelist.ts:265-281` and `:334-338` today:

```ts
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = addInput.value;
    const result: WhitelistAddResult = await addToWhitelist(raw);
    if (result === "added") {
      const username = normalizeUsername(raw);
      if (username) entries = [...entries, username];
      addInput.value = "";
      addInput.removeAttribute("data-invalid");
      addCaption.hidden = true;
      drawTable();
      addInput.focus();
      tableArea
        .querySelector(".xb-opt-table-row:last-child")
        ?.scrollIntoView?.({ block: "nearest" });
      return;
    }
```

```ts
  return {
    destroy() {
      if (searchDebounce !== undefined) clearTimeout(searchDebounce);
    },
  };
```

The virtual list's own header comment (`entrypoints/options/virtual-list.ts:1-2`) says the whitelist table is flat. After this plan that sentence is false; step 5 handles it.

Repo conventions that bind this work:

- Keep every existing comment exactly as written, except the one named in step 5. Do not add new comments. A repository hook (`doc-lock`) rejects comment changes outside documentation work; step 5's comment edit is part of this plan's stated scope, and if the hook rejects it, leave the comment and report it.
- Do not add lint suppressions or `as` type assertions.
- `bunfig.toml` sets `coverageThreshold = 1.0`. Every new line and branch needs a test.
- happy-dom (the test DOM) never lays elements out, so `clientHeight` is 0. Tests pass a fixed viewport height through an option, as the Blocked log does.
- Design rules from `PRODUCT.md`: every interactive element keeps its hover, focus-visible, active, disabled states. Do not change class names or StyleX styles.
- Package manager is `bun`. `npm` and `npx` are prohibited.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Format check | `bun run format:check` | exit 0 (run `bun run format` to fix) |
| Focused tests | `bun test test/options/whitelist.test.ts` | all pass |
| Full tests | `bun test` | all pass, coverage threshold met |

## Scope

**In scope**:

- `entrypoints/options/panes/whitelist.ts`
- `entrypoints/options/virtual-list.ts` (only the two-line header comment, step 5)
- `test/options/whitelist.test.ts`

**Out of scope** (do NOT touch):

- `entrypoints/options/virtual-list.ts` logic — plan 007 changes it.
- `entrypoints/options/options-table.stylex.ts` and every other `*.stylex.ts` file.
- `packages/storage/whitelist-store.ts` — store calls keep their signatures.
- `entrypoints/options/main.ts` — it calls `renderWhitelistPane(container)`; the new second parameter is optional.
- `tools/design/**` visual snapshots. Do not run `bun run design:update`.
- The import size cap `WHITELIST_IMPORT_MAX`.

## Git workflow

- Branch: `advisor/006-virtualize-whitelist-table`
- One commit per step is fine. Conventional style, for example `perf(options): virtualize the whitelist table`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the pane options and the failing tests

1. Export `WHITELIST_ROW_HEIGHT = 40` from `whitelist.ts`.
2. Change the signature to `renderWhitelistPane(container: HTMLElement, opts: WhitelistPaneOptions = {})` with `export type WhitelistPaneOptions = { getViewportHeight?: () => number };`. Model it on `BlockedLogPaneOptions` in `blocked-log.ts:93-98`.
3. Add tests to `test/options/whitelist.test.ts`:
   - With 5,000 seeded handles and `getViewportHeight: () => 360`, the number of `.xb-opt-table-row` elements is below 60.
   - After typing a search and advancing the debounce, the row count is still below 60 and the footer reads `N of 5000 handles` with the right N.
   - Scrolling the scroll container (`scrollTop = WHITELIST_ROW_HEIGHT * 1000`, dispatch `scroll`) renders the row for index 1000.
   - Remove with confirmations on: first click shows `Confirm?`; a scroll that re-renders the window keeps `Confirm?` on that handle's row; second click removes it and the footer count drops by one.
   - Remove with confirmations off: one click removes.
   - The confirm state expires after `WHITELIST_CONFIRM_WINDOW_MS`.
   - Adding a handle scrolls the container to the end and the new row is rendered.
   - `destroy()` clears a pending confirm timer and removes the scroll listener (no error, no timer fires afterwards).

**Verify**: `bun test test/options/whitelist.test.ts` → the new tests fail, the existing ones pass.

### Step 2: Keep one list plus a lowercase twin

Replace `let entries = [...whitelist];` with two parallel arrays: `entries` (the stored list as returned, no copy) and `entriesLower` (each handle lower-cased once). Keep them in step:

- add: `push` to both;
- remove: find the index in `entriesLower`, `splice` both;
- import: reassign both from the fresh `getWhitelist()` result.

`visibleEntries()` filters by `entriesLower[i].includes(needle)` and returns the matching original handles. When there is no query it returns `entries` itself.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Build the table once and render rows through the virtual list

1. Split `drawTable()`:
   - `buildTable()` creates the table, the head, and a scroll container with `styles.tableScroll` (copy the structure from `buildTable()` in `blocked-log.ts:344-374`), then creates the list with `createVirtualList<string>({ container: scroll, rowHeight: WHITELIST_ROW_HEIGHT, renderRow, ...(opts.getViewportHeight ? { getViewportHeight: opts.getViewportHeight } : {}) })`.
   - `refresh()` updates the footer, handles the two empty states exactly as today (same elements, texts, and classes), builds the table if it does not exist, and calls `virtualList.setItems(visible)`.
2. `renderRow(handle)` returns the same row element as today (same classes, `gridTemplateColumns`, `tabIndex = 0`, the handle cell) with a remove button that has the same class and `aria-label`, plus `data-handle="<handle>"`. If `handle` is the one currently awaiting confirmation, render the button in its confirming state (`dataset.confirming = "true"`, text `Confirm?`). Otherwise render the cross icon.
3. Replace every `drawTable()` call with `refresh()`.

**Verify**: `bun test test/options/whitelist.test.ts` → the row-count and scroll tests pass.

### Step 4: Move remove handling to one delegated listener

1. Delete `createRemoveControl`. Keep pane-level state: `confirmingHandle: string | undefined` and `confirmTimer`.
2. Add one `click` listener on the scroll container. It finds `event.target.closest("button[data-handle]")`. With no match it returns.
3. For a match: if `confirmRequired` is false, or `confirmingHandle` equals the button's handle, clear the confirm state, `await removeFromWhitelist(handle)`, splice both arrays, and call `refresh()`. Otherwise set `confirmingHandle`, start the timer for `WHITELIST_CONFIRM_WINDOW_MS` that clears the state and calls `virtualList.render()`, and call `virtualList.render()` now.
4. Ignore a click on a handle whose removal is already in flight (keep a `Set` of handles being removed).
5. In the add-form handler, replace the `querySelector(".xb-opt-table-row:last-child")?.scrollIntoView` call with: set the scroll container's `scrollTop` to `entries.length * WHITELIST_ROW_HEIGHT` and call `virtualList.render()`. Do this only when no search query is active.
6. `destroy()` must also clear `confirmTimer`, remove the click listener, and call `virtualList.destroy()`.

**Verify**: `bun test test/options/whitelist.test.ts` → all pass.

### Step 5: Correct the stale header comment

In `entrypoints/options/virtual-list.ts:1-2`, the comment says the Blocked log is "the only table in the settings surface that virtualizes (the whitelist table is flat; see plan.md)". Change those two lines to state that both the Blocked log and the Whitelist tables use it. Change nothing else in that file.

**Verify**: `rg -n "whitelist table is flat" entrypoints/options/virtual-list.ts` → no matches. If the `doc-lock` hook rejects the edit, leave the comment and say so in your report.

### Step 6: Run the full gates

**Verify**:

- `bun run typecheck` → exit 0
- `bun run lint` → exit 0
- `bun run format:check` → exit 0
- `bun test` → all pass, coverage threshold met

## Test plan

- The eight tests in step 1, in `test/options/whitelist.test.ts`.
- Structural pattern: the virtual-list tests in `test/options/blocked-log.test.ts` (they pass `getViewportHeight` and dispatch `scroll`), and the existing confirm-remove tests in `test/options/whitelist.test.ts`.
- Existing whitelist tests that count all rows for small lists must still pass: a small list fits inside the window.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` exit 0
- [ ] `bun test` exits 0 with the new tests present and passing
- [ ] `rg -n "createRemoveControl|drawTable" entrypoints/options/panes/whitelist.ts` returns no matches
- [ ] `rg -n "createVirtualList" entrypoints/options/panes/whitelist.ts` returns one match
- [ ] `git status --short` lists only in-scope files (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated
- [ ] Your report tells the owner to run `bun run design` and review any whitelist snapshot difference

## STOP conditions

Stop and report back if:

- The quoted code does not match the live file.
- `tableRow` in `entrypoints/options/options-table.stylex.ts:142-163` no longer sets `height: 40`. Report the value you find instead of guessing.
- An existing test depends on every row being in the DOM for a list longer than about 30 handles.
- The change seems to need an edit in `virtual-list.ts` logic or a `*.stylex.ts` file.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The table now has a 560 px maximum height with its own scrollbar, as the Blocked log has. That is a visible change for long lists. The owner should confirm it in the browser.
- Keyboard focus after a remove: the focused row is replaced. Moving focus to the row at the same index is a possible follow-up; the Blocked log's `focusRow` (`blocked-log.ts:396-412`) is the pattern.
- The pane still does not update when another context changes the whitelist while it is open.
- Reviewers: test with a list of at least 10,000 handles in a real browser, search, and remove one from the middle.
