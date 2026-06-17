# conway

Conway's Game of Life. Classical `B3/S23` rule on a W×H grid; per-
axis boundary (`wall` or `wrap`). Zero player input — the player
observes; the substrate runs.

## How it plays

- **Play / pause** — the toolbar's transport drives ticks.
- **Speed selector** — 1× through 16×.
- **Halt detection** — Conway lenses watch for stable cycles and
  emit a halt annotation that surfaces as a "draw" banner.

No clicks place anything; the lens deliberately ships no kit. This
is the smallest possible substrate: one channel
(`cells: Uint8Array`), one rule, no inputs.

## Code layout

- `engine/` — `state.ts`, `tick.ts`, `channels.ts`, `bttf-adapter.ts`,
  `level.ts`. The tick reads neighbours under per-axis wrap and
  writes the next generation.
- `lens/` — single canvas2d grid lens. Declares `AUTOPLAY`,
  `SINGLE_BRANCH`, `SAFE_AREA`.
- `puzzles/` — glider, blinker, r-pentomino, random-density seed.

## What this substrate is for

An engine-generality demo. Conway shares no domain with the other worlds — no
agents, no field, no biases, no win condition — so its presence
exercises the substrate-package contract at the substrate-shape
extreme of "zero input, one rule, one channel."
