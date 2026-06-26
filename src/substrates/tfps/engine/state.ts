import type { TfpsConfig } from "./config";
import type { SubstrateState } from "./types";

// A plain-object State (no channels — one camera, not a population). Both the
// read and write buffers start at the spawn pose; the first tick fills write
// from read like any substrate.
export function makeState(config: TfpsConfig): SubstrateState {
  return {
    tick: 0,
    px: config.spawnX,
    py: config.spawnY,
    angle: config.spawnAngle,
  };
}

// Nothing shared/immutable to bake — the world lives in Config. `allocSubstrate`
// calls this on the read side at startup; makeState already seeded the spawn.
export function initState(_state: SubstrateState, _config: TfpsConfig): void {
  // intentionally empty
}
