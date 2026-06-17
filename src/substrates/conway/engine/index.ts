// Conway substrate package. Engine-generality demo — proves the engine +
// substrate-bundle contract is genuinely substrate-agnostic by hosting GoL
// with zero engine-side accommodations.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { buildChannels } from "./channels";
import { initState, makeState } from "./state";
import { tickConway } from "./tick";
import type { ConwayConfig } from "./config";
import type { ConwayInputs, SubstrateState } from "./types";

export const conwayBundle: SubstrateBundle<SubstrateState, ConwayConfig, ConwayInputs> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickConway,
};

// Frontend — matches the standard allocSubstrate / swap / tick shape
// so the web layer can use the same idiom across substrates.

export function allocSubstrate(config: ConwayConfig): Substrate<SubstrateState> {
  return engineAlloc(conwayBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: ConwayConfig,
  rng: RNGState,
): { rng: RNGState } {
  const next = engineTick(conwayBundle, substrate, config, rng, {});
  return { rng: next };
}

export { parseLevel, type LevelFile } from "./level";
export {
  COMMIT_PERIOD,
  conwayBttfAdapter,
  snapshotConway,
  type ConwayCommitPayload,
} from "./bttf-adapter";
export type { ConwayConfig, SeedPattern } from "./config";
export type { ConwayInputs, SubstrateState } from "./types";
export type { RNGState, Substrate } from "@/engine/types";
