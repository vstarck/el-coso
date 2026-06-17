// Blockoide tick — the whole Causality:
//   carry → (first spawn) → rotate taps (3 axes) → held plane move
//   (cooldown) → hard drop | gravity → lock → clear layers → win/lose →
//   spawn next. Pure and rng-threaded: piece draws are the only stochastic
//   step.

import type { RNGState } from "@/engine/types";
import { nextRange } from "@/engine/rng";
import type { BlockoideConfig } from "./config";
import { EMPTY, WALL, type BlockoideInputs, type SubstrateState } from "./types";
import {
  PIECE_NAMES,
  pieceCells,
  pieceExtent,
  rotateOrient,
  type Axis,
} from "./pieces";

function idx(s: SubstrateState, x: number, y: number, z: number): number {
  return z * (s.W * s.D) + y * s.W + x;
}

// Does the piece (kind, orient) at (px, py, pz) collide with the four
// walls, the floor, or an occupied cell (settled block or obstacle)? Cells
// above the opening (z < 0) are legal — pieces enter from there.
export function collides(
  s: SubstrateState,
  kind: number,
  orient: number,
  px: number,
  py: number,
  pz: number,
): boolean {
  for (const c of pieceCells(kind, orient)) {
    const x = px + c.x;
    const y = py + c.y;
    const z = pz + c.z;
    if (x < 0 || x >= s.W || y < 0 || y >= s.D || z >= s.H) return true;
    if (z >= 0 && s.cells[idx(s, x, y, z)] !== EMPTY) return true;
  }
  return false;
}

// The resting base z for a piece dropped straight down from (px, py, fromZ):
// the deepest z at which it doesn't collide (so z+1 would). Shared by the
// engine's hard drop, the autopilot's placement search, and the lens
// ghost/landing renders — same drop-to-rest in one place.
export function landingZ(
  s: SubstrateState,
  kind: number,
  orient: number,
  px: number,
  py: number,
  fromZ: number,
): number {
  let z = fromZ;
  while (!collides(s, kind, orient, px, py, z + 1)) z++;
  return z;
}

function rollKind(rng: RNGState): { kind: number; rng: RNGState } {
  const draw = nextRange(rng, 0, PIECE_NAMES.length);
  let k = Math.floor(draw.value);
  if (k >= PIECE_NAMES.length) k = PIECE_NAMES.length - 1; // hi exclusive; guard fp edge
  return { kind: k, rng: draw.rng };
}

// Make `kind` the falling piece at the top-center. Topping out (the fresh
// piece overlaps the stack / an obstacle) is the lose condition.
function spawn(w: SubstrateState, kind: number): void {
  w.piece_kind = kind;
  w.orient = 0;
  const { ex, ey } = pieceExtent(kind, 0);
  w.piece_x = Math.floor((w.W - ex) / 2);
  w.piece_y = Math.floor((w.D - ey) / 2);
  w.piece_z = 0;
  w.drop_acc = 0;
  w.spawn_count += 1;
  if (collides(w, kind, 0, w.piece_x, w.piece_y, w.piece_z)) w.outcome = "lost";
}

// True if every cell of layer z is occupied AND at least one is a piece
// (an all-wall layer is "full" but has nothing to clear). Walls satisfy a
// layer — the obstacle is helper-and-constraint at once. Exported for
// tests (the collapse rule is the substrate's subtlest invariant).
export function layerComplete(s: SubstrateState, z: number): boolean {
  let hasPiece = false;
  for (let y = 0; y < s.D; y++) {
    for (let x = 0; x < s.W; x++) {
      const v = s.cells[idx(s, x, y, z)] ?? 0;
      if (v === EMPTY) return false;
      if (v !== WALL) hasPiece = true;
    }
  }
  return hasPiece;
}

// Clear layer Z with classic shift-by-one collapse, per column, bounded by
// permanent cells: above the cleared layer, piece cells fall one step; a
// wall is immovable and holds up everything above it. With no walls this
// is exactly uniform shift. Exported for tests.
export function clearLayer(s: SubstrateState, Z: number): void {
  for (let y = 0; y < s.D; y++) {
    for (let x = 0; x < s.W; x++) {
      if (s.cells[idx(s, x, y, Z)] === WALL) continue; // wall holds its cell
      s.cells[idx(s, x, y, Z)] = EMPTY; // remove the cleared piece
      let z = Z;
      while (z >= 1 && s.cells[idx(s, x, y, z - 1)] !== WALL) {
        s.cells[idx(s, x, y, z)] = s.cells[idx(s, x, y, z - 1)] ?? 0;
        s.cells[idx(s, x, y, z - 1)] = EMPTY;
        z -= 1;
      }
    }
  }
}

// Stamp the piece into the stack, clear full layers, evaluate win/lose,
// and hand the turn to the next piece.
function lockAndRespawn(
  w: SubstrateState,
  config: BlockoideConfig,
  rng: RNGState,
): RNGState {
  for (const c of pieceCells(w.piece_kind, w.orient)) {
    const z = w.piece_z + c.z;
    if (z < 0) {
      // Locked above the opening — the stack is through the ceiling.
      w.outcome = "lost";
      return rng;
    }
    w.cells[idx(w, w.piece_x + c.x, w.piece_y + c.y, z)] = w.piece_kind + 1;
  }

  // Clear complete layers deepest-first, re-checking the same depth after a
  // collapse (the shift may refill it).
  let cleared = 0;
  for (let z = w.H - 1; z >= 0; z--) {
    if (!layerComplete(w, z)) continue;
    clearLayer(w, z);
    cleared += 1;
    z++; // re-check this depth
  }
  w.layers += cleared;

  if (config.win_layers > 0 && w.layers >= config.win_layers) {
    w.outcome = "won";
    return rng;
  }

  const roll = rollKind(rng);
  spawn(w, w.next_kind);
  w.next_kind = roll.kind;
  return roll.rng;
}

// A small 3D kick set: in place, then ±1 on each axis, then ±2 on the
// plane axes. The first non-colliding offset wins.
const KICKS: Array<[number, number, number]> = [
  [0, 0, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [-2, 0, 0],
  [2, 0, 0],
  [0, -2, 0],
  [0, 2, 0],
];

function tryRotate(w: SubstrateState, axis: Axis, dir: number): void {
  // +1 = one 90° step; -1 = three steps (== −90°).
  let orient = w.orient;
  const steps = dir > 0 ? 1 : 3;
  for (let i = 0; i < steps; i++) orient = rotateOrient(w.piece_kind, orient, axis);
  for (const [kx, ky, kz] of KICKS) {
    if (!collides(w, w.piece_kind, orient, w.piece_x + kx, w.piece_y + ky, w.piece_z + kz)) {
      w.orient = orient;
      w.piece_x += kx;
      w.piece_y += ky;
      w.piece_z += kz;
      return;
    }
  }
}

export function tickBlockoide(
  r: SubstrateState,
  w: SubstrateState,
  config: BlockoideConfig,
  rng: RNGState,
  inputs: BlockoideInputs,
): RNGState {
  // Carry forward.
  w.W = r.W;
  w.D = r.D;
  w.H = r.H;
  w.cells.set(r.cells);
  w.piece_kind = r.piece_kind;
  w.orient = r.orient;
  w.piece_x = r.piece_x;
  w.piece_y = r.piece_y;
  w.piece_z = r.piece_z;
  w.next_kind = r.next_kind;
  w.drop_acc = r.drop_acc;
  w.move_cooldown = r.move_cooldown;
  w.spawn_count = r.spawn_count;
  w.layers = r.layers;
  w.outcome = r.outcome;
  w.tick = r.tick + 1;

  if (r.outcome !== "in_progress") return rng; // frozen — the run is over

  // First tick: draw the opening piece and the preview.
  if (w.piece_kind < 0) {
    const first = rollKind(rng);
    const second = rollKind(first.rng);
    spawn(w, first.kind);
    w.next_kind = second.kind;
    return second.rng;
  }

  // Rotation taps (edges by input contract — at most one per axis per tick).
  if (inputs.rot_x !== 0) tryRotate(w, "x", inputs.rot_x);
  if (inputs.rot_y !== 0) tryRotate(w, "y", inputs.rot_y);
  if (inputs.rot_z !== 0) tryRotate(w, "z", inputs.rot_z);

  // Held plane move with substrate-side auto-repeat. Releasing both axes
  // resets the cooldown so the next press steps immediately.
  if (w.move_cooldown > 0) w.move_cooldown -= 1;
  const mx = inputs.move_x < 0 ? -1 : inputs.move_x > 0 ? 1 : 0;
  const my = inputs.move_y < 0 ? -1 : inputs.move_y > 0 ? 1 : 0;
  if (mx === 0 && my === 0) {
    w.move_cooldown = 0;
  } else if (w.move_cooldown === 0) {
    if (mx !== 0 && !collides(w, w.piece_kind, w.orient, w.piece_x + mx, w.piece_y, w.piece_z)) {
      w.piece_x += mx;
    }
    if (my !== 0 && !collides(w, w.piece_kind, w.orient, w.piece_x, w.piece_y + my, w.piece_z)) {
      w.piece_y += my;
    }
    w.move_cooldown = config.move_period;
  }

  // Hard drop: straight to the floor, lock this very tick.
  if (inputs.hard) {
    w.piece_z = landingZ(w, w.piece_kind, w.orient, w.piece_x, w.piece_y, w.piece_z);
    return lockAndRespawn(w, config, rng);
  }

  // Gravity. Soft drop multiplies the accumulator gain, not the rules.
  w.drop_acc += inputs.soft ? config.soft_factor : 1;
  while (w.drop_acc >= config.gravity_period && w.outcome === "in_progress") {
    w.drop_acc -= config.gravity_period;
    if (!collides(w, w.piece_kind, w.orient, w.piece_x, w.piece_y, w.piece_z + 1)) {
      w.piece_z += 1;
    } else {
      rng = lockAndRespawn(w, config, rng);
    }
  }
  return rng;
}
