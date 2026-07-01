# julia

An **escape-time fractal** showcase: the Julia set of `z → z² + c`, rendered
live with the parameter `c` drifting along an orbit so the set continuously
morphs. **Mandelbrot mode** is the same renderer with the pixel driving `c` — the
atlas of every Julia set.

Why it earns its place beyond "pretty": it's the engine's thesis made visual.

- **Trivial rule → infinite structure** (like conway, but continuous).
- **`max_iter` is slice thickness** — a shallow iteration budget physically can't
  resolve the boundary filaments a deep one reveals. It's a different lens, not a
  degraded one. The most direct demonstration of slice thickness in the project.
- **The Mandelbrot set is the atlas of all Julia sets** — so `c` is a natural
  parameter to steer, and "understanding" is navigating that space.

## Structure

- **State** = `c` (two floats) + orbit `phase`. The fractal isn't stored — the
  lens computes it. Tiny state ⇒ trivial keyframes, exact replay.
- **Config** = orbit (center / radius / speed), `mode`, internal render `res`.
- **Causality** = advance the phase, recompute `c`. Deterministic, no RNG.
- **Lens** = the escape-time renderer (the non-trivial forward operator). View
  tunables are the vocabulary: `max_iter`, `palette`, `zoom`, `center`, `mode`.

## Interaction

- **Drag** to pan, **wheel** to zoom (cursor-anchored).
- **Backtick** opens the guake console (this substrate is the 2nd adopter of
  `@/lenses/withConsole`): `c <re> <im>`, `iters <n>`, `zoom <f>`,
  `center <re> <im>`, `palette fire|ice|structure`, `mode julia|mandelbrot`,
  `smooth`, `reset`, `play`/`pause`.

## Puzzles

- **`tour`** *(default)* — `c` orbits; the Julia set morphs.
- **`rabbit`** — the still Douady rabbit; explore with iterations + zoom.
- **`mandelbrot`** — the atlas, with a marker touring `c`.

Rendered on a capped internal buffer (CSS-scaled to fill) and recomputed only
when `c` or a view tunable changes — a paused or still set is free.
