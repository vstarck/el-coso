// abismo substrate package — engine subdir barrel.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { initState, makeState } from "./state";
import { tickAbismo } from "./tick";
import type { AbismoConfig } from "./config";
import type { AbismoInputs, SubstrateState } from "./types";

export const abismoBundle: SubstrateBundle<SubstrateState, AbismoConfig, AbismoInputs> = {
  alloc: (config: AbismoConfig) => ({ read: makeState(config), write: makeState(config) }),
  initState,
  tick: tickAbismo,
};

export function allocSubstrate(config: AbismoConfig): Substrate<SubstrateState> {
  return engineAlloc(abismoBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: AbismoConfig,
  rng: RNGState,
  inputs: AbismoInputs,
): RNGState {
  return engineTick(abismoBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export {
  COMMIT_PERIOD,
  abismoBttfAdapter,
  snapshotAbismo,
  type AbismoCommitPayload,
} from "./bttf-adapter";
export type { AbismoConfig };
export type { SubstrateState, AbismoInputs } from "./types";
