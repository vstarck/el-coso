# `new-substrate` — scaffold a substrate package

Removes the busywork around starting a new `src/substrates/<name>/`
package. It scaffolds a **no-op-but-green** package — one that compiles,
registers, mounts, and ticks a no-op — so you start from a working skeleton
and fill the verbs (physics / render / puzzles) instead of plumbing.

```
npm run new-substrate                            # interactive, asks the name
npm run new-substrate -- <name>                  # interactive, name prefilled
npm run new-substrate -- <name> --from a.json    # non-interactive
npm run new-substrate:v0 -- <name>               # v0: copy-rename only
```

The wizard walks the **six design questions** (`docs/guide.md`)
and pre-toggles the kit imports, `Inputs` shape, storage alloc, commit
predicate, and feature flags from your answers. `<name>` is kebab-case.
`a.json` keys are the six question ids: `render`, `viewport`, `storage`,
`agency`, `pace`, `commit`.

It generates:

1. the package — files an answer affects are templated; the rest fall back
   to a renamed copy of `src/substrates/example/` (so `example/` stays the
   single source for the invariant files). `Example`/`example` → your name
   in all casings (`exampleBundle` → camel, `example-grid` → kebab,
   `ExampleConfig` → Pascal, `meta.name` → Title Case);
2. `DESIGN.md` — your six answers, captured.

(No registry edit: the roster in `src/app/substrates.ts` is glob-discovered from
`src/substrates/<name>/index.ts`, so the new package registers by simply
existing.)

It does **not** write the real **tick** (physics), **render**, or
**puzzles** — that's the thinking. After scaffolding, fill `engine/` +
`lens/` + `puzzles/` and verify with `npx tsc --noEmit && npx vitest run`.

## Anti-drift

`questions.mjs` is the single source of truth. It drives the wizard prompts,
the template toggles, **and** (via the doc-sync test) the
authoring-doc mirror — so the three cannot drift. The
**rot-test** (`tests/new-substrate-rot.test.mjs`) generates a covering
answer-set and asserts `tsc` stays green, catching template rot the moment
the engine/lens/history contracts move.

## Tiers

- **v0 (`scaffold.mjs`)** — dumb copy-rename (auto-discovered by the glob
  roster). Dependency-free ESM, no questions. The zero-dep fallback
  (`new-substrate:v0`).
- **v1 (`cli.mjs`)** — the wizard. `@clack/prompts` is lazy-imported only for
  the interactive path, so `--from` runs without it.
