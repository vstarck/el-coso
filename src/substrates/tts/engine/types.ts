// tts — the simplest possible Tetris. Settled blocks live in one doubled
// occupancy channel (`cells`); the falling piece is scalars (it is the only
// moving thing, and it becomes cells the instant it locks). The lens is a
// plain-JSON terminal readout, so pieces are distinguished by a glyph (one
// letter per tetromino) rather than by color.

export type TtsOutcome = "in_progress" | "won" | "lost";

export type SubstrateState = {
  W: number;
  H: number;
  // Settled blocks, length W*H, row-major, doubled. 0 = empty; v = piece
  // kind + 1 (1..7) so the view can glyph a stack by the pieces that built
  // it.
  cells: Uint8Array;

  // The falling piece. kind -1 = none yet — the first tick spawns it
  // (initState has no rng arg; all randomness threads through tick).
  piece_kind: number; // -1, or 0..6 — index into TETROMINOES
  piece_rot: number; // 0..3 quarter-turns clockwise
  piece_x: number; // board coords of the rotated shape's bbox origin
  piece_y: number;
  next_kind: number; // -1 until the first spawn

  drop_acc: number; // gravity accumulator; one row per gravity_period
  move_cooldown: number; // ticks until the next held horizontal step
  spawn_count: number; // total pieces spawned — the commit trigger
  lines: number; // total lines cleared
  outcome: TtsOutcome;
  tick: number;
};

// Per-tick input — the player's entire action surface. `move` is a held
// value the lens samples every tick; `rotate` and `drop` are taps the lens
// drains from its buffer (at most one of each per tick) so they are edges by
// construction. Down and Space both map to `drop`.
export type TtsInputs = {
  move: number; // -1 | 0 | 1, held horizontal
  rotate: number; // 0 | 1, tap — clockwise quarter-turn
  drop: boolean; // tap — drop to floor and lock this tick
};
