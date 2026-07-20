# AGENTS.md

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `fpcMotif/xblocker`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock skills triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: root `CONTEXT.md` plus `docs/adr/` when needed. See `docs/agents/domain.md`.

### Package conventions

Packages are deep modules — import only a package's root entry points, never its subfolder internals; see [packages/README.md](./packages/README.md) before adding or importing one.
