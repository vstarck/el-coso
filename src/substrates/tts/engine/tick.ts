// tts tick — the whole Causality:
//   carry → (first spawn) → rotate tap → held move (cooldown) →
//   drop tap | gravity → lock → clear lines → win/lose → spawn next.
// Pure and rng-threaded: piece draws are the only stochastic step.

import type { RNGState } from "@/engine/types";
import { nextRange } from "@/engine/rng";
import type { TtsConfig } from "./config";
import type { TtsInputs, SubstrateState } from "./types";
import { TETROMINOES, pieceCells, pieceWidth } from "./pieces";

// Does the piece (kind, rot) at (px, py) collide with walls, floor, or the
// settled stack? Cells above the top (y < 0) are legal — pieces enter from
// there.
export function collides(
  s: SubstrateState,
  kind: number,
  rot: number,
  px: number,
  py: number,
): boolean {
  for (const c of pieceCells(kind, rot)) {
    const x = px + c.x;
    const y = py + c.y;
    if (x < 0 || x >= s.W || y >= s.H) return true;
    if (y >= 0 && s.cells[y * s.W + x] !== 0) return true;
  }
  return false;
}

function rollKind(rng: RNGState): { kind: number; rng: RNGState } {
  const draw = nextRange(rng, 0, TETROMINOES.length);
  let k = Math.floor(draw.value);
  if (k >= TETROMINOES.length) k = TETROMINOES.length - 1; // hi is exclusive; guard fp edge
  return { kind: k, rng: draw.rng };
}

// Make `kind` the falling piece at the top-center. Topping out (the fresh
// piece overlaps the stack) is the lose condition.
function spawn(w: SubstrateState, kind: number): void {
  w.piece_kind = kind;
  w.piece_rot = 0;
  w.piece_x = Math.floor((w.W - pieceWidth(kind, 0)) / 2);
  w.piece_y = 0;
  w.drop_acc = 0;
  w.spawn_count += 1;
  if (collides(w, kind, 0, w.piece_x, w.piece_y)) w.outcome = "lost";
}

// Stamp the piece into the stack, clear full rows, evaluate win/lose, and
// hand the turn to the next piece.
function lockAndRespawn(w: SubstrateState, config: TtsConfig, rng: RNGState): RNGState {
  for (const c of pieceCells(w.piece_kind, w.piece_rot)) {
    const y = w.piece_y + c.y;
    if (y < 0) {
      // Locked above the visible board — the stack is through the ceiling.
      w.outcome = "lost";
      return rng;
    }
    w.cells[y * w.W + (w.piece_x + c.x)] = w.piece_kind + 1;
  }

  // Clear full rows bottom-up, shifting everything above down.
  let cleared = 0;
  for (let y = w.H - 1; y >= 0; y--) {
    let full = true;
    for (let x = 0; x < w.W; x++) {
      if (w.cells[y * w.W + x] === 0) {
        full = false;
        break;
      }
    }
    if (!full) continue;
    cleared += 1;
    for (let yy = y; yy > 0; yy--) {
      for (let x = 0; x < w.W; x++) {
        w.cells[yy * w.W + x] = w.cells[(yy - 1) * w.W + x] ?? 0;
      }
    }
    for (let x = 0; x < w.W; x++) w.cells[x] = 0;
    y++; // re-check the same row — the shift may have filled it again
  }
  w.lines += cleared;

  if (config.win_lines > 0 && w.lines >= config.win_lines) {
    w.outcome = "won";
    return rng;
  }

  const roll = rollKind(rng);
  spawn(w, w.next_kind);
  w.next_kind = roll.kind;
  return roll.rng;
}

// Single clockwise quarter-turn (Up = rotate). Wall kicks: in place, then
// one or two cells sideways.
function tryRotate(w: SubstrateState): void {
  const rot = (w.piece_rot + 1) % 4;
  const kicks = [0, -1, 1, -2, 2];
  for (const k of kicks) {
    if (!collides(w, w.piece_kind, rot, w.piece_x + k, w.piece_y)) {
      w.piece_rot = rot;
      w.piece_x += k;
      return;
    }
  }
}

export function tickTts(
  r: SubstrateState,
  w: SubstrateState,
  config: TtsConfig,
  rng: RNGState,
  inputs: TtsInputs,
): RNGState {
  // Carry forward.
  w.W = r.W;
  w.H = r.H;
  w.cells.set(r.cells);
  w.piece_kind = r.piece_kind;
  w.piece_rot = r.piece_rot;
  w.piece_x = r.piece_x;
  w.piece_y = r.piece_y;
  w.next_kind = r.next_kind;
  w.drop_acc = r.drop_acc;
  w.move_cooldown = r.move_cooldown;
  w.spawn_count = r.spawn_count;
  w.lines = r.lines;
  w.outcome = r.outcome;
  w.tick = r.tick + 1;

  if (r.outcome !== "in_progress") return rng; // frozen — the run is over

  // First tick: draw the opening piece and the preview.
  if (w.piece_kind < 0) {
    const first = rollKind(rng);
    const second = rollKind(first.rng);
    w.next_kind = first.kind;
    spawn(w, first.kind);
    w.next_kind = second.kind;
    return second.rng;
  }

  // Rotation tap (an edge by input contract — at most one per tick).
  if (inputs.rotate !== 0) tryRotate(w);

  // Held horizontal with substrate-side auto-repeat. Releasing resets the
  // cooldown so the next press steps immediately.
  if (w.move_cooldown > 0) w.move_cooldown -= 1;
  const mv = inputs.move < 0 ? -1 : inputs.move > 0 ? 1 : 0;
  if (mv === 0) {
    w.move_cooldown = 0;
  } else if (w.move_cooldown === 0) {
    if (!collides(w, w.piece_kind, w.piece_rot, w.piece_x + mv, w.piece_y)) {
      w.piece_x += mv;
    }
    w.move_cooldown = config.move_period;
  }

  // Drop (Down / Space): straight to the floor, lock this very tick.
  if (inputs.drop) {
    while (!collides(w, w.piece_kind, w.piece_rot, w.piece_x, w.piece_y + 1)) {
      w.piece_y += 1;
    }
    return lockAndRespawn(w, config, rng);
  }

  // Gravity. One row per gravity_period base ticks.
  w.drop_acc += 1;
  while (w.drop_acc >= config.gravity_period && w.outcome === "in_progress") {
    w.drop_acc -= config.gravity_period;
    if (!collides(w, w.piece_kind, w.piece_rot, w.piece_x, w.piece_y + 1)) {
      w.piece_y += 1;
    } else {
      rng = lockAndRespawn(w, config, rng);
    }
  }
  return rng;
}
