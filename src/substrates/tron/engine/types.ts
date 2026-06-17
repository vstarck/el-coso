// Tron substrate state. A light-cycle leaves a solid trail on a grid; the
// player steers a held heading and dies on contact with any trail or the
// arena border. One doubled occupancy channel (`cells`) plus scalars
// (head position, heading, liveness, outcome, tick).
//
// Naming mirrors the other substrates: the state struct is `SubstrateState`
// *locally*; cross-package callers refer to it through the package
// (`import type { SubstrateState } from "../substrates/tron"`).

export type TronDir = "up" | "down" | "left" | "right";
export type TronOutcome = "in_progress" | "won" | "lost";

// One AI cycle's changing pose. The immutable behavior bias lives on the
// matching TronFoeSpawn in config, looked up by index
// A plain array of these on
// SubstrateState survives keyframing (history deep-clones plain arrays).
export type TronFoe = {
  x: number;
  y: number;
  heading: TronDir;
  alive: number; // 0 or 1
};

export type SubstrateState = {
  W: number;
  H: number;
  // Occupancy grid, length W*H, doubled. 0 = empty, 1 = the player's
  // trail (including the head cell), and owner id `i+2` for AI foe `i`.
  // The tick treats *any* non-zero cell as a fatal wall, so player and
  // foes kill each other through the same check.
  cells: Uint8Array;

  head_x: number;
  head_y: number;
  heading: TronDir;
  alive: number;          // 0 or 1 — the player
  foes: TronFoe[];        // parallel to config.foes by index
  outcome: TronOutcome;
  tick: number;
};

// Per-tick input — the player's held desired heading, sampled by the lens
// at each tick boundary from live keyboard state (Q4 *continuous / held*).
// "none" = no key held → the cycle keeps its current heading. A 180°
// reversal of the current heading is rejected by the tick (you can't turn
// back into your own trail), so the held value is advisory, not absolute.
export type TronInputs = {
  desired: TronDir | "none";
};
