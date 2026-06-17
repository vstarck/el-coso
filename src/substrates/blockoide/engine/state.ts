import type { ChannelBag } from "@/engine/channels";
import type { BlockoideConfig } from "./config";
import { WALL, type SubstrateState } from "./types";

// Wire the engine-allocated channel bag into the typed state struct.
export function makeState(bag: ChannelBag, config: BlockoideConfig): SubstrateState {
  const cells = bag.cells;
  if (!(cells instanceof Uint8Array)) {
    throw new Error("channel 'cells' missing or not Uint8Array");
  }
  return {
    W: config.W,
    D: config.D,
    H: config.H,
    cells,
    piece_kind: -1,
    orient: 0,
    piece_x: 0,
    piece_y: 0,
    piece_z: 0,
    next_kind: -1,
    drop_acc: 0,
    move_cooldown: 0,
    spawn_count: 0,
    layers: 0,
    outcome: "in_progress",
    tick: 0,
  };
}

// Stamp the authored permanent obstacles into the well; the first tick
// spawns the first piece (randomness threads through tick's rng —
// initState has none by contract). Both read and write states are seeded
// (the engine calls initState on the allocated pair).
export function initState(state: SubstrateState, config: BlockoideConfig): void {
  for (const i of config.walls) {
    if (i >= 0 && i < state.cells.length) state.cells[i] = WALL;
  }
}
