// tts substrate package — engine subdir barrel.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { buildChannels } from "./channels";
import { initState, makeState } from "./state";
import { tickTts } from "./tick";
import type { TtsConfig } from "./config";
import type { TtsInputs, SubstrateState } from "./types";

export const ttsBundle: SubstrateBundle<SubstrateState, TtsConfig, TtsInputs> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickTts,
};

export function allocSubstrate(config: TtsConfig): Substrate<SubstrateState> {
  return engineAlloc(ttsBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: TtsConfig,
  rng: RNGState,
  inputs: TtsInputs,
): RNGState {
  return engineTick(ttsBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export {
  ttsBttfAdapter,
  snapshotTts,
  type TtsCommitPayload,
} from "./bttf-adapter";
export { collides } from "./tick";
export {
  TETROMINOES,
  PIECE_NAMES,
  pieceCells,
  pieceWidth,
  type Cell,
} from "./pieces";
export type { TtsConfig };
export type { SubstrateState, TtsInputs, TtsOutcome } from "./types";
export type { RNGState, Substrate } from "@/engine/types";
