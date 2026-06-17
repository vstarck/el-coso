// DVD-screensaver substrate — engine barrel. A single Verlet particle
// bouncing in a continuous box; autonomous (no input). Its reason to exist is
// the composite lens (see ../lens), which layers velocity / acceleration /
// jitter / projection overlays over the particle with an in-canvas HUD that
// toggles them.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { buildChannels } from "./channels";
import { initState, makeState } from "./state";
import { tickDvd } from "./tick";
import type { DvdConfig } from "./config";
import type { DvdInputs, SubstrateState } from "./types";

export const dvdBundle: SubstrateBundle<SubstrateState, DvdConfig, DvdInputs> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickDvd,
};

export function allocSubstrate(config: DvdConfig): Substrate<SubstrateState> {
  return engineAlloc(dvdBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: DvdConfig,
  rng: RNGState,
  inputs: DvdInputs,
): RNGState {
  return engineTick(dvdBundle, substrate, config, rng, inputs);
}

export { integrateAndReflect } from "./tick";
export { parseLevel, type LevelFile } from "./level";
export {
  COMMIT_PERIOD,
  dvdBttfAdapter,
  snapshotDvd,
  type DvdCommitPayload,
} from "./bttf-adapter";
export type { DvdConfig, DvdInputs, SubstrateState };
