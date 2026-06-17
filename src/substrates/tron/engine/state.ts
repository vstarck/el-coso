import type { ChannelBag } from "@/engine/channels";
import type { TronConfig } from "./config";
import type { SubstrateState, TronFoe } from "./types";

// Wire an engine-allocated channel bag into the typed state struct. Built
// twice (read + write bags) — each call constructs its own `foes` array, so
// read and write never alias.
export function makeState(bag: ChannelBag, config: TronConfig): SubstrateState {
  const cells = bag.cells;
  if (!(cells instanceof Uint8Array)) {
    throw new Error("channel 'cells' missing or not Uint8Array");
  }
  const foes: TronFoe[] = config.foes.map((f) => ({
    x: f.start_x,
    y: f.start_y,
    heading: f.start_heading,
    alive: 1,
  }));
  return {
    W: config.W,
    H: config.H,
    cells,
    head_x: config.start_x,
    head_y: config.start_y,
    heading: config.start_heading,
    alive: 1,
    foes,
    outcome: "in_progress",
    tick: 0,
  };
}

// Mark every cycle's starting cell occupied with its owner id (player = 1,
// foe i = i+2) so each cycle sits on its own trail from tick 0. Runs on the
// read buffer only; the first tick copies read→write and lays the next
// cells.
export function initState(state: SubstrateState, config: TronConfig): void {
  state.cells[config.start_y * config.W + config.start_x] = 1;
  config.foes.forEach((f, i) => {
    state.cells[f.start_y * config.W + f.start_x] = i + 2;
  });
}
