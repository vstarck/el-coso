// tfps substrate package — engine subdir barrel.
//
// A first-person raycaster world. Unlike the channel-backed substrates, tfps
// uses a plain-object State (one camera, not a population), so `alloc` just
// hands back two fresh state objects — no `channelAlloc`.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { initState, makeState } from "./state";
import { tickTfps } from "./tick";
import type { TfpsConfig } from "./config";
import type { TfpsInputs, SubstrateState } from "./types";

export const tfpsBundle: SubstrateBundle<
  SubstrateState,
  TfpsConfig,
  TfpsInputs
> = {
  alloc: (config) => ({ read: makeState(config), write: makeState(config) }),
  initState,
  tick: tickTfps,
};

export function allocSubstrate(config: TfpsConfig): Substrate<SubstrateState> {
  return engineAlloc(tfpsBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: TfpsConfig,
  rng: RNGState,
  inputs: TfpsInputs,
): RNGState {
  return engineTick(tfpsBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export { isWall, tileAt, type TfpsConfig } from "./config";
export { tryMove } from "./tick";
export {
  COMMIT_PERIOD,
  tfpsBttfAdapter,
  snapshotTfps,
  type TfpsCommitPayload,
} from "./bttf-adapter";
export { NO_INPUT } from "./types";
export type { SubstrateState, TfpsInputs };
export type { RNGState, Substrate } from "@/engine/types";
