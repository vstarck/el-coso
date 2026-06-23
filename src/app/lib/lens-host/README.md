# `src/app/lib/lens-host/` — shared lens lifecycle helpers

**Chrome-tier. May import `useStore`, history, DOM. Not translatable.**

Mount-time scaffolding shared across lenses regardless of render target.
The **host** (`SubstrateHost`) owns the single rAF loop; a lens declares
its pace through what it returns on `MountedLens` (Q5 of the
design-questions pipeline), not by importing a loop helper.

Extracted helpers:

- **`subscribe-head.ts`** — `subscribeHead(render)` — fires `render`
  whenever `playheadTick` or `historyVersion` shifts. This is the
  store-backed implementation of `LensHost.subscribeHead`: `storeLensHost`
  delegates to it, so a lens reaches it as `host.subscribeHead(render)`
  (the store-free `makeLensHost` has its own observable). Lenses do **not**
  import this directly — turn-based lenses use `host.subscribeHead` for a
  commit-driven re-render alongside the host's per-frame `renderFrom`.
  Consumer: `storeLensHost`.
- **`raf-loop.ts`** — `attachRafLoop({ render, tick?, isPlaying?,
  speedMult? })` — requestAnimationFrame driver. **Host-internal:**
  `SubstrateHost` calls it once per mount, wiring `render` to every
  mounted lens's `renderFrom` and pulling `tick` / `speedMult` from
  the root lens when it exposes them. `tick` optional → the one helper
  covers ticking roots (e.g. conway) and render-only roots (turn-based
  lenses). The accumulator drains while `isPlaying()` returns true
  and the helper isn't stopped. A lens never calls this itself — it
  exposes `tick` + `speedMult` and the host drives. Consumer:
  `SubstrateHost`.
The lens-composition scaffold (`compose-space.ts`) is host-agnostic (no
store), so it lives at `src/lib/lens-host/compose-space.ts`. See that dir's
README.
