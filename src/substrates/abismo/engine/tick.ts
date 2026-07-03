import type { RNGState } from "@/engine/types";
import type { AbismoConfig } from "./config";
import type { AbismoInputs, SubstrateState } from "./types";

// Causality: depth integrates the scroll input, clamped to [0, depth_max]. That
// is the whole simulation — everything visible is a pure function of depth, and
// because depth is a coordinate the step is exactly invertible (a −scrollDelta
// undoes a +scrollDelta). No RNG is consumed ⇒ byte-deterministic replay.
export function tickAbismo(
  r: SubstrateState,
  w: SubstrateState,
  config: AbismoConfig,
  rng: RNGState,
  inputs: AbismoInputs,
): RNGState {
  w.tick = r.tick + 1;
  const d = r.depth + inputs.scrollDelta;
  w.depth = d < 0 ? 0 : d > config.depth_max ? config.depth_max : d;
  return rng;
}
