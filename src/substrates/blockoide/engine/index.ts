// Blockoide substrate package — engine subdir barrel.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import { buildChannels } from "./channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { initState, makeState } from "./state";
import { tickBlockoide } from "./tick";
import type { BlockoideConfig } from "./config";
import type { BlockoideInputs, SubstrateState } from "./types";

export const blockoideBundle: SubstrateBundle<
  SubstrateState,
  BlockoideConfig,
  BlockoideInputs
> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickBlockoide,
};

export function allocSubstrate(config: BlockoideConfig): Substrate<SubstrateState> {
  return engineAlloc(blockoideBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: BlockoideConfig,
  rng: RNGState,
  inputs: BlockoideInputs,
): RNGState {
  return engineTick(blockoideBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export {
  blockoideBttfAdapter,
  blockoidePayload,
  type BlockoideCommitPayload,
} from "./bttf-adapter";
export { hashState } from "./hash";
export {
  PIECE_NAMES,
  pieceCells,
  pieceExtent,
  rotateOrient,
  orientCount,
  type Cell3,
  type Axis,
} from "./pieces";
export { collides, landingZ, layerComplete, clearLayer } from "./tick";
export type { BlockoideConfig };

// Substrate-level history cadence — how often the history layer keyframes a
// full snapshot. Lives here (store-free) so both the package `meta` and the
// react-less embed read one source; the embed can't import the package barrel
// (it pulls the store via the lens wrapper).
export const KEYFRAME_PERIOD = 100;
export { EMPTY, WALL } from "./types";
export type { SubstrateState, BlockoideInputs, BlockoideOutcome } from "./types";
