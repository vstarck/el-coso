import type { ChannelBag } from "@/engine/channels";
import type { PentrisConfig } from "./config";
import type { SubstrateState } from "./types";

// Wire the engine-allocated channel bag into the typed state struct.
export function makeState(bag: ChannelBag, config: PentrisConfig): SubstrateState {
  const cells = bag.cells;
  if (!(cells instanceof Uint8Array)) {
    throw new Error("channel 'cells' missing or not Uint8Array");
  }
  return {
    W: config.W,
    H: config.H,
    cells,
    piece_kind: -1,
    piece_rot: 0,
    piece_x: 0,
    piece_y: 0,
    next_kind: -1,
    drop_acc: 0,
    move_cooldown: 0,
    spawn_count: 0,
    lines: 0,
    outcome: "in_progress",
    tick: 0,
  };
}

// Board starts empty; the first tick spawns the first piece (randomness
// threads through tick's rng — initState has none by contract).
export function initState(_state: SubstrateState, _config: PentrisConfig): void {
  // intentionally empty
}
