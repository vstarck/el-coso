// Pentris substrate package — engine subdir barrel.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import { buildChannels } from "./channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { initState, makeState } from "./state";
import { tickPentris } from "./tick";
import type { PentrisConfig } from "./config";
import type { PentrisInputs, SubstrateState } from "./types";

export const pentrisBundle: SubstrateBundle<SubstrateState, PentrisConfig, PentrisInputs> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickPentris,
};

export function allocSubstrate(config: PentrisConfig): Substrate<SubstrateState> {
  return engineAlloc(pentrisBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: PentrisConfig,
  rng: RNGState,
  inputs: PentrisInputs,
): RNGState {
  return engineTick(pentrisBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export {
  pentrisBttfAdapter,
  pentrisPayload,
  type PentrisCommitPayload,
} from "./bttf-adapter";
export { hashState } from "./hash";
export { PENTOMINOES, PIECE_NAMES, pieceCells, pieceWidth, type Cell } from "./pieces";
export { collides } from "./tick";
export type { PentrisConfig };
export type { SubstrateState, PentrisInputs, PentrisOutcome } from "./types";
