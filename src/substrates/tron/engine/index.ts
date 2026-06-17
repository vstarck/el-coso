// Tron substrate package — engine subdir barrel. Held-input light-cycle:
// the player steers a continuous heading sampled every tick, the cycle
// lays a fatal trail, survive to the target tick to win. The first
// AUTOPLAY substrate with recorded per-tick input — the worked example
// the Agency design question (Q4) and the `attachKeyControls` kit grew
// out of.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { buildChannels } from "./channels";
import { initState, makeState } from "./state";
import { tickTron } from "./tick";
import type { TronConfig } from "./config";
import type { SubstrateState, TronInputs } from "./types";

export const tronBundle: SubstrateBundle<SubstrateState, TronConfig, TronInputs> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickTron,
};

export function allocSubstrate(config: TronConfig): Substrate<SubstrateState> {
  return engineAlloc(tronBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: TronConfig,
  rng: RNGState,
  inputs: TronInputs,
): RNGState {
  return engineTick(tronBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile, type FoeFile } from "./level";
export {
  COMMIT_PERIOD,
  tronBttfAdapter,
  snapshotTron,
  type TronCommitPayload,
} from "./bttf-adapter";
export type { TronConfig, TronFoeBehavior, TronFoeSpawn } from "./config";
export type { SubstrateState, TronDir, TronFoe, TronInputs, TronOutcome } from "./types";
