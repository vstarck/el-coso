// Julia substrate package — engine subdir barrel.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { initState, makeState } from "./state";
import { tickJulia } from "./tick";
import type { JuliaConfig } from "./config";
import type { JuliaInputs, SubstrateState } from "./types";

export const juliaBundle: SubstrateBundle<SubstrateState, JuliaConfig, JuliaInputs> = {
  alloc: (config: JuliaConfig) => ({ read: makeState(config), write: makeState(config) }),
  initState,
  tick: tickJulia,
};

export function allocSubstrate(config: JuliaConfig): Substrate<SubstrateState> {
  return engineAlloc(juliaBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: JuliaConfig,
  rng: RNGState,
  inputs: JuliaInputs,
): RNGState {
  return engineTick(juliaBundle, substrate, config, rng, inputs);
}

export { cAtPhase } from "./config";
export type { FractalMode, Orbit } from "./config";
export { parseLevel, type LevelFile } from "./level";
export {
  COMMIT_PERIOD,
  juliaBttfAdapter,
  snapshotJulia,
  type JuliaCommitPayload,
} from "./bttf-adapter";
export type { JuliaConfig };
export type { SubstrateState, JuliaInputs } from "./types";
