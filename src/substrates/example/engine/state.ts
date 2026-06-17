import type { ChannelBag } from "@/engine/channels";
import type { ExampleConfig } from "./config";
import type { SubstrateState } from "./types";

// Wire an engine-allocated channel bag into the substrate's typed state
// shape. Scalars are zero-defaulted; the first tick advances them.
export function makeState(bag: ChannelBag, config: ExampleConfig): SubstrateState {
  const counter = bag.counter;
  if (!(counter instanceof Float32Array)) {
    throw new Error("channel 'counter' missing or not Float32Array");
  }
  return {
    W: config.W,
    H: config.H,
    counter,
    tick: 0,
  };
}

// Populate shared/immutable channels once. The no-op example has none.
// Real substrates use this hook to bake authored fields, initial state,
// etc. into the read/write-shared channels (`doubled: false` descriptors).
export function initState(_state: SubstrateState, _config: ExampleConfig): void {
  // intentionally empty
}
