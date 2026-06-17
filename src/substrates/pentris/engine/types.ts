// Pentris substrate state. A falling-block stacker built on the twelve
// free pentominoes (5-cell pieces). Settled blocks live in one doubled
// occupancy channel (`cells`); the falling piece is scalars — it is the
// only moving thing, and it becomes cells the moment it locks.

export type PentrisOutcome = "in_progress" | "won" | "lost";

export type SubstrateState = {
  W: number;
  H: number;
  // Settled blocks, length W*H, doubled. 0 = empty; v = piece kind + 1
  // (1..12) so the lens colors a stack by the pieces that built it.
  cells: Uint8Array;

  // The falling piece. kind -1 = none yet — the first tick spawns it
  // (initState has no rng arg; all randomness threads through tick).
  piece_kind: number; // -1, or 0..11 — index into PENTOMINOES
  piece_rot: number; // 0..3 quarter-turns clockwise
  piece_x: number; // board coords of the rotated shape's bbox origin
  piece_y: number;
  next_kind: number; // -1 until the first spawn

  drop_acc: number; // gravity accumulator; soft drop adds soft_factor/tick
  move_cooldown: number; // ticks until the next held horizontal step
  spawn_count: number; // total pieces spawned — the commit trigger (Q6)
  lines: number; // total lines cleared
  outcome: PentrisOutcome;
  tick: number;
};

// Per-tick input — the player's entire action surface (Q4). `move` and
// `soft` are held values the lens samples every tick; `rotate` and `hard`
// are taps the lens drains from its buffer, at most one of each per tick,
// so they are edges by construction (no key-repeat smearing).
export type PentrisInputs = {
  move: number; // -1 | 0 | 1, held horizontal
  rotate: number; // -1 (ccw) | 0 | 1 (cw), tap
  soft: boolean; // held soft drop
  hard: boolean; // tap — drop to floor and lock this tick
};
