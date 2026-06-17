import type { RNGState, Substrate, SubstrateBundle } from "./types";
import { allocSubstrate, swap, tick } from "./substrate";

// Drive a substrate headlessly: alloc, then apply one input per tick,
// swapping each step, and return the final read State. This is the
// executable form of the engine's headless promise — no chrome, no
// history layer, no rAF, no DOM.
//
// `inputs` is one entry per tick (`inputs.length` ticks run). A held /
// continuous input is just the same value repeated; a no-agency substrate
// passes the empty input `{}` repeated as many times as you want to step.
//
// The terminal `outcome` — and all other substrate state — lives on the
// returned State (architecture.md *Invariants* #2: a State fully describes
// the substrate at one tick). So a headless run *is* the win/lose check:
//
//   runHeadless(bundle, config, seed, Array(5).fill({ desired: "none" }))
//     .outcome === "won"
//
// Determinism: same (config, seed, inputs) → byte-identical State, so this
// also drives snapshot / determinism / reachability tests. For commit-shape,
// replay, or branch assertions, drive the history layer instead
// (`createHistory` + `historyTick`); for scene round-trips, the scene-stack
// runtime.
export function runHeadless<State, Config, Inputs>(
  bundle: SubstrateBundle<State, Config, Inputs>,
  config: Config,
  seed: number,
  inputs: Inputs[],
): State {
  const substrate: Substrate<State> = allocSubstrate(bundle, config);
  let rng: RNGState = { seed };
  for (const input of inputs) {
    rng = tick(bundle, substrate, config, rng, input);
    swap(substrate);
  }
  return substrate.read;
}
