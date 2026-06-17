import type { TronDir } from "./types";

// Per-foe behavior bias — the knobs that make each AI cycle play
// differently. All deterministic: the tick rolls them against the threaded
// rng, never Math.random.
export type TronFoeBehavior = {
  // 0..1 — when cruising, the chance per tick to instead steer toward the
  // player's current cell (among safe directions). 0 = oblivious wanderer,
  // 1 = relentless hunter.
  aggression: number;
  // Tie-break rotation when the foe must turn (straight is blocked) or when
  // it has no aggressive target: which way it prefers to peel off.
  turn_pref: "left" | "right";
  // 0..1 — chance per tick to pick a random safe direction instead of its
  // usual logic. Adds chaos / unpredictability.
  jitter: number;
};

// One authored AI cycle: where it starts and how it thinks. Immutable
// per-puzzle (the kind table); the cycle's changing pose lives in
// SubstrateState.foes.
export type TronFoeSpawn = {
  start_x: number;
  start_y: number;
  start_heading: TronDir;
  behavior: TronFoeBehavior;
};

// Tron substrate config. Arena dimensions, the player cycle's start pose,
// the survival target, and zero or more AI foes. Reach `survive_ticks`
// alive ⇒ win; the foes are moving hazards that leave deadly trails.
export type TronConfig = {
  id: string;
  W: number;
  H: number;
  start_x: number;
  start_y: number;
  start_heading: TronDir;
  survive_ticks: number;
  foes: TronFoeSpawn[];
};
