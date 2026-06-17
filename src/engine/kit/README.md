# `src/engine/kit/` — shared substrate-tier helpers

**Translatable TypeScript. No DOM, no React, no `useStore`.**

This directory holds substrate-tier helpers that 2+ substrates have
extracted from longhand. The discipline is *extract-don't-design*: a
helper lands here only after a second substrate would otherwise duplicate
it. The first substrate keeps the code longhand in its own
`engine/` directory.

Picked by the *design-questions pipeline* (see [`docs/guide.md`](../../../docs/guide.md#scaffold-a-new-substrate)):

- **State shape** — `channelAlloc` (lives one level up at
  [`../channels.ts`](../channels.ts) since it's the original kit member),
  forthcoming `sparse/entities.ts`, etc.
- **Commit triggers** — forthcoming `bttf/commit-every-n.ts`,
  `bttf/commit-on-tick-advance.ts`.
- **Topology** — forthcoming `grid/hex.ts`, `grid/square.ts`.

This README will list extracted helpers as they land. Today: none.
