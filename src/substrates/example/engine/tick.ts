import type { ExampleConfig } from "./config";
import type { RNGState } from "@/engine/types";
import type { ExampleInputs, SubstrateState } from "./types";

// No-op tick: advances the tick counter and increments each counter cell
// by 1. Demonstrates the substep-composition pattern without simulating
// any real dynamics. Replace with the substrate's actual tick logic.
//
// Real substrates compose substeps — e.g. `mergeAndAgeBiases
// → updateFields → stepAgents → despawnInBasin → spawnAgents`. Each
// substep is a free function reading from `r` and writing to `w`. Keep
// each substep substrate-package-internal; the engine sees only the
// composed `tick` exported through the bundle.
export function tickExample(
  r: SubstrateState,
  w: SubstrateState,
  config: ExampleConfig,
  rng: RNGState,
  _inputs: ExampleInputs,
): RNGState {
  // (0) Carry scalars forward.
  w.W = r.W;
  w.H = r.H;
  w.tick = r.tick + 1;

  // (1) Single substep: increment per-cell counter. Replace with real
  //     substeps the substrate needs.
  const N = config.W * config.H;
  for (let i = 0; i < N; i++) {
    w.counter[i] = (r.counter[i] ?? 0) + 1;
  }

  return rng;
}
