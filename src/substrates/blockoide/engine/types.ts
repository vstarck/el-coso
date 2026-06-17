// Blockoide substrate state — 3D Tetris (Blockout). Polycubes fall down a
// W×D×H well viewed from above; a completed horizontal layer (a constant-z
// slice) clears. Settled blocks live in one doubled occupancy channel
// (`cells`); the falling piece is scalars — it is the only moving thing,
// and it becomes cells the moment it locks.

export type BlockoideOutcome = "in_progress" | "won" | "lost";

// Cell values in `cells`: 0 empty; 1..7 = piece kind + 1; WALL = a
// permanent, authored obstacle that satisfies a layer but never clears.
export const EMPTY = 0;
export const WALL = 255;

export type SubstrateState = {
  W: number; // cross-section width  (x)
  D: number; // cross-section depth  (y)
  H: number; // well height          (z) — z=0 is the opening, z=H-1 the floor
  // Settled blocks + walls, length W*D*H, doubled. Indexed
  // z*(W*D) + y*W + x.
  cells: Uint8Array;

  // The falling piece. kind -1 = none yet — the first tick spawns it
  // (initState seeds only the authored well; all randomness threads
  // through tick).
  piece_kind: number; // -1, or 0..6 — index into PIECE_NAMES
  orient: number; // index into the kind's precomputed orientation set
  piece_x: number; // well coords of the oriented shape's bbox origin
  piece_y: number;
  piece_z: number;
  next_kind: number; // -1 until the first spawn

  drop_acc: number; // gravity accumulator; soft drop adds soft_factor/tick
  move_cooldown: number; // ticks until the next held plane step
  spawn_count: number; // total pieces spawned — the commit trigger
  layers: number; // total layers cleared
  outcome: BlockoideOutcome;
  tick: number;
};

// Per-tick input — the player's entire action surface. `move_*` and `soft`
// are held values the lens samples every tick; `rot_*` and `hard` are taps
// the lens drains from its buffers, at most one of each per tick, so they
// are edges by construction.
export type BlockoideInputs = {
  move_x: number; // -1 | 0 | 1, held
  move_y: number; // -1 | 0 | 1, held
  rot_x: number; // -1 | 0 | 1, tap — rotate about the x axis
  rot_y: number; // -1 | 0 | 1, tap
  rot_z: number; // -1 | 0 | 1, tap
  soft: boolean; // held soft drop
  hard: boolean; // tap — drop to the floor and lock this tick
};
