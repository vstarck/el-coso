import { cAtPhase, type JuliaConfig } from "./config";
import type { SubstrateState } from "./types";

// Plain-object alloc — no channels. Called once per buffer (read + write).
export function makeState(_config: JuliaConfig): SubstrateState {
  return { c_re: 0, c_im: 0, phase: 0, tick: 0 };
}

// One-time init on the read buffer — seed c from the orbit's phase-0 point.
export function initState(state: SubstrateState, config: JuliaConfig): void {
  state.phase = 0;
  const c = cAtPhase(config.orbit, 0);
  state.c_re = c.re;
  state.c_im = c.im;
  state.tick = 0;
}
