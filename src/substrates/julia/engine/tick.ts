import { cAtPhase, type JuliaConfig } from "./config";
import type { RNGState } from "@/engine/types";
import type { JuliaInputs, SubstrateState } from "./types";

// Causality: advance the orbit phase one step and recompute c from it. Fully
// deterministic — no RNG — so keyframes/branches/replay are exact. A speed-0
// orbit leaves c fixed (a still set the player explores through the lens).
export function tickJulia(
  r: SubstrateState,
  w: SubstrateState,
  config: JuliaConfig,
  rng: RNGState,
  _inputs: JuliaInputs,
): RNGState {
  w.tick = r.tick + 1;
  w.phase = r.phase + config.orbit.speed;
  const c = cAtPhase(config.orbit, w.phase);
  w.c_re = c.re;
  w.c_im = c.im;
  return rng;
}
