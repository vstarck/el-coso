import type { AbismoConfig } from "./config";
import type { SubstrateState } from "./types";

// Plain-object alloc — no channels. Called once per buffer (read + write).
export function makeState(_config: AbismoConfig): SubstrateState {
  return { depth: 0, tick: 0 };
}

// One-time init on the read buffer — start fully zoomed out (depth 0).
export function initState(state: SubstrateState, _config: AbismoConfig): void {
  state.depth = 0;
  state.tick = 0;
}
