// Example substrate package — no-op scaffold for authoring a new substrate.
// Mirrors the structure of a real substrate package. Compiles and runs but
// produces no meaningful dynamics — its purpose is to be copied as a
// starting template.
//
// To author a new substrate:
//   1. Copy this directory to `src/substrates/<name>/`.
//   2. Replace each file's contents with the real material.
//   3. Update imports in the file `<name>/index.ts` accordingly.
//   4. Document the substrate (what it is, the lenses, the puzzles).
//
// See `src/substrates/conway/` for a worked instance.

import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import { channelAlloc } from "@/engine/channels";
import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

import { buildChannels } from "./channels";
import { initState, makeState } from "./state";
import { tickExample } from "./tick";
import type { ExampleConfig } from "./config";
import type { ExampleInputs, SubstrateState } from "./types";

export const exampleBundle: SubstrateBundle<SubstrateState, ExampleConfig, ExampleInputs> = {
  alloc: channelAlloc(buildChannels, makeState),
  initState,
  tick: tickExample,
};

// Frontend — preserves the engine's allocate/swap/tick shape under a
// substrate-flavored signature. Real substrates can re-shape this to fit
// caller ergonomics (e.g. a substrate may wrap inputs into `TickInput`/`TickOutput`).
export function allocSubstrate(config: ExampleConfig): Substrate<SubstrateState> {
  return engineAlloc(exampleBundle, config);
}

export function swap(substrate: Substrate<SubstrateState>): void {
  engineSwap(substrate);
}

export function tick(
  substrate: Substrate<SubstrateState>,
  config: ExampleConfig,
  rng: RNGState,
  inputs: ExampleInputs,
): RNGState {
  return engineTick(exampleBundle, substrate, config, rng, inputs);
}

export { parseLevel, type LevelFile } from "./level";
export {
  COMMIT_PERIOD,
  exampleBttfAdapter,
  snapshotExample,
  type ExampleCommitPayload,
} from "./bttf-adapter";
export type { ExampleConfig, ExampleInputs, SubstrateState };
