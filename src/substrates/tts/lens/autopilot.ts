/* tts autopilot — a greedy heuristic that plays the game for the `auto`
 * command, in two layers:
 *
 *   chooseMove(state)   — pure: for the current falling piece it simulates
 *                         every landing (4 rotations × every column), scores
 *                         the resulting board, and returns the best one.
 *   makeAutopilot(seed) — a stateful, paced driver around chooseMove: it picks
 *                         a landing once per piece, then steps toward it
 *                         (rotate → slide → drop) with a jittered delay so the
 *                         self-play reads as deliberate, not instant.
 *
 * The score is the well-known "El-Tetris" linear combination of four board
 * features — aggregate height, completed lines, holes, bumpiness — which
 * plays a clean endless game without any search depth. Weights are constants
 * below; tune them to taste.
 *
 * chooseMove is pure: reads a board snapshot, allocates a scratch copy per
 * candidate, never mutates the substrate. `collides` / `pieceCells` come from
 * the engine so the simulated drop matches the real one exactly.
 */

import { nextRange } from "@/engine/rng";
import {
  collides,
  pieceCells,
  type RNGState,
  type SubstrateState,
  type TtsInputs,
} from "../engine";

const W_AGGREGATE_HEIGHT = -0.510066;
const W_COMPLETE_LINES = 0.760666;
const W_HOLES = -0.35663;
const W_BUMPINESS = -0.184483;

export type AutoMove = { rot: number; x: number };

// A throwaway board the engine's `collides` can read (it only touches
// W / H / cells).
function probe(W: number, H: number, cells: Uint8Array): SubstrateState {
  return { W, H, cells } as unknown as SubstrateState;
}

// Resting row for (kind, rot) dropped straight down at column origin `x`, or
// null if it can't even enter there.
function landingY(
  W: number,
  H: number,
  cells: Uint8Array,
  kind: number,
  rot: number,
  x: number,
): number | null {
  const p = probe(W, H, cells);
  let y = -4; // safely above the board (cells with y < 0 are legal)
  if (collides(p, kind, rot, x, y)) return null;
  while (!collides(p, kind, rot, x, y + 1)) y++;
  return y;
}

// Score the board that results from locking (kind, rot) at column `x`. Returns
// null when the placement is illegal or tops out (locks above the ceiling).
function scorePlacement(
  W: number,
  H: number,
  base: Uint8Array,
  kind: number,
  rot: number,
  x: number,
): number | null {
  const y = landingY(W, H, base, kind, rot, x);
  if (y === null) return null;

  const cells = new Uint8Array(base);
  for (const c of pieceCells(kind, rot)) {
    const cy = y + c.y;
    const cx = x + c.x;
    if (cy < 0) return null; // locked above the ceiling — a top-out
    cells[cy * W + cx] = kind + 1;
  }

  // Clear full rows (same bottom-up shift the engine does).
  let lines = 0;
  for (let row = H - 1; row >= 0; row--) {
    let full = true;
    for (let cx = 0; cx < W; cx++) {
      if (cells[row * W + cx] === 0) {
        full = false;
        break;
      }
    }
    if (!full) continue;
    lines++;
    for (let r = row; r > 0; r--) {
      for (let cx = 0; cx < W; cx++) cells[r * W + cx] = cells[(r - 1) * W + cx]!;
    }
    for (let cx = 0; cx < W; cx++) cells[cx] = 0;
    row++; // re-check the shifted row
  }

  // Per-column heights (distance from the floor to the topmost filled cell).
  const heights: number[] = new Array(W).fill(0);
  for (let cx = 0; cx < W; cx++) {
    for (let row = 0; row < H; row++) {
      if (cells[row * W + cx] !== 0) {
        heights[cx] = H - row;
        break;
      }
    }
  }

  let aggregate = 0;
  let holes = 0;
  for (let cx = 0; cx < W; cx++) {
    aggregate += heights[cx]!;
    const top = H - heights[cx]!; // first filled row index
    for (let row = top + 1; row < H; row++) {
      if (cells[row * W + cx] === 0) holes++;
    }
  }
  let bumpiness = 0;
  for (let cx = 0; cx < W - 1; cx++) {
    bumpiness += Math.abs(heights[cx]! - heights[cx + 1]!);
  }

  return (
    W_AGGREGATE_HEIGHT * aggregate +
    W_COMPLETE_LINES * lines +
    W_HOLES * holes +
    W_BUMPINESS * bumpiness
  );
}

// Best landing for the current falling piece, or null if none is placeable.
export function chooseMove(state: SubstrateState): AutoMove | null {
  if (state.piece_kind < 0) return null;
  const W = state.W;
  const H = state.H;
  const kind = state.piece_kind;

  let best: AutoMove | null = null;
  let best_score = -Infinity;
  for (let rot = 0; rot < 4; rot++) {
    let max_x = 0;
    for (const c of pieceCells(kind, rot)) if (c.x > max_x) max_x = c.x;
    for (let x = 0; x + max_x < W; x++) {
      const score = scorePlacement(W, H, state.cells, kind, rot, x);
      if (score === null) continue;
      if (score > best_score) {
        best_score = score;
        best = { rot, x };
      }
    }
  }
  return best;
}

// --- Paced stepping driver --------------------------------------------------

// Each action waits `BASE + rng(0..JITTER)` ticks before the next, so the
// self-play reads as deliberate (and a touch irregular) rather than snapping
// pieces into place instantly. During a cooldown the piece just drifts under
// gravity (occasionally costing a perfect placement — the wiggle).
const ACTION_DELAY_BASE = 5;
const ACTION_DELAY_JITTER = 9;
// Offset the jitter seed off the substrate's RNG so the two streams don't move
// in lockstep with the piece draws.
const SEED_OFFSET = 0x9e3779b9;

const NEUTRAL: TtsInputs = { move: 0, rotate: 0, drop: false };

export type Autopilot = {
  // The input to feed the substrate this tick (NEUTRAL during a cooldown).
  inputs(state: SubstrateState): TtsInputs;
  // Drop the current per-piece plan so the next call re-plans for the live
  // piece (after a rewind or an `auto` take-over toggle). Keeps the pacing
  // stream flowing.
  replan(): void;
  // replan() + re-seed the pacing stream — a fresh, identically-paced run
  // (after a restart).
  reset(): void;
};

// A stateful, deterministic paced player. The jitter is drawn from a dedicated
// PRNG stream seeded off the run, so the paced run is reproducible.
export function makeAutopilot(runSeed: number): Autopilot {
  const seed = (runSeed + SEED_OFFSET) >>> 0;
  let target: AutoMove | null = null;
  let for_spawn = -1;
  let cooldown = 0;
  let rng: RNGState = { seed };

  function replan(): void {
    target = null;
    for_spawn = -1;
    cooldown = 0;
  }

  return {
    inputs(state: SubstrateState): TtsInputs {
      if (state.piece_kind < 0) return NEUTRAL;
      if (state.spawn_count !== for_spawn || target === null) {
        target = chooseMove(state);
        for_spawn = state.spawn_count;
      }
      if (cooldown > 0) {
        cooldown -= 1;
        return NEUTRAL;
      }
      const t = target;
      if (!t) return { move: 0, rotate: 0, drop: true }; // nowhere to land — bail

      let input: TtsInputs;
      if (state.piece_rot !== t.rot) input = { move: 0, rotate: 1, drop: false };
      else if (state.piece_x < t.x) input = { move: 1, rotate: 0, drop: false };
      else if (state.piece_x > t.x) input = { move: -1, rotate: 0, drop: false };
      else input = { move: 0, rotate: 0, drop: true };

      // Schedule the next action after a jittered, RNG-driven delay.
      const draw = nextRange(rng, 0, ACTION_DELAY_JITTER + 1);
      rng = draw.rng;
      cooldown = ACTION_DELAY_BASE + Math.floor(draw.value);
      return input;
    },
    replan,
    reset(): void {
      replan();
      rng = { seed };
    },
  };
}
