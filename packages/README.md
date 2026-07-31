# Packages

Each package under `packages/` is a "deep module": a small public surface hiding
implementation detail behind it.

```
packages/<name>/
  index.ts        # entry point (public surface)
  client.ts       # another entry point, if needed
  lib/            # hidden implementation
  tests/          # co-located tests
```

Root files (`index.ts`, `client.ts`, ...) are a package's entry points — its
public surface. Everything else is private. `packages/example/` is a starter
template: copy it to start a new package, or delete it if you don't need it.

## The rule

Code outside a package may import only that package's root files, never
anything inside its subfolders. Public vs. private is decided purely by
depth — any subfolder is private, so adding new folders never needs a config
change. A package's own files may import each other freely, including into
`lib/`.

```ts
// from app code or another package (paths relative to the importer): OK
import { greet } from "../../packages/example/index";

// NOT allowed — reaches into the package's internals
import { titleCase } from "../../packages/example/lib/impl";
```

## Tests

A package's `tests/` files import the package through its entry points (e.g.
`../index`), and may use their own `tests/` fixtures. They may never
deep-import any package's internals — not even their own package's `lib/`.

## No cycles

No dependency cycles, within or across packages. `type-only` and lazy
`dynamic-import` edges are exempt — they carry no module-init order, and the
app deliberately closes loops with them (e.g. `sync-engine` lazy-loads
`convex-sync`, which imports back only a type).

## Avoid barrel files

Don't re-export a whole subtree through one giant `index.ts`. Prefer several
small, purpose-specific entry points (`index.ts`, `client.ts`, `server.ts`,
...) and keep implementation hidden in `lib/`.

## Flat packages

`packages/` is one flat tier — a package may not contain another package.
Internals may nest as deeply as needed under `lib/`.

## Checking

```
bun run lint:boundaries
```

This runs dependency-cruiser against `.dependency-cruiser.cjs` at the repo
root, and is also part of `bun run check`.
