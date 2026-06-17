# `src/lib/lens-host/` — host-agnostic lens-composition helpers

**Host-agnostic. No React, no store. Depends only on `@/history` + `@/lenses`.**

Author-side scaffolding for composing lenses, usable from any host (the React
chrome, the embed, headless). The store-coupled lifecycle helpers
(`raf-loop`, `subscribe-head`) stay chrome-tier in `src/app/lib/lens-host/`.

- **`compose-space.ts`** — `composeSimpleSpace(space, { overlays?, hud?, … })` —
  the first author-side **composite scaffold**. Decorates a base "space" lens
  into a composing `Lens`: sets `layers = [...overlays, hud]`, recovers the
  mounted children by lens id (zips the declared `layers` order against
  `args.children` — host invariant), forwards each HUD `["show",
  overlay.id]` toggle to that overlay's `["visible"]` tunable, and composites
  the snapshot across visible children. The simple case only — one space, flat
  overlay list, ≤1 HUD, boolean toggles. Consumers: dvd-screensaver.
