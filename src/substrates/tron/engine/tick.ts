import type { TronConfig, TronFoeBehavior } from "./config";
import type { RNGState } from "@/engine/types";
import { nextUniform } from "@/engine/rng";
import type { SubstrateState, TronDir, TronFoe, TronInputs } from "./types";

const DIRS: TronDir[] = ["up", "down", "left", "right"];

const DELTAS: Record<TronDir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const OPPOSITE: Record<TronDir, TronDir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// 90° rotations, used for turn-preference tie-breaks.
const LEFT_OF: Record<TronDir, TronDir> = { up: "left", left: "down", down: "right", right: "up" };
const RIGHT_OF: Record<TronDir, TronDir> = { up: "right", right: "down", down: "left", left: "up" };

// One step of the world. Deterministic — the only stochastic element is the
// foe AI, which threads the explicit `rng` (no Math.random) so replay,
// branch, and scene re-derivation stay bit-exact.
//
// Order within a tick: carry scalars + copy the trail forward; freeze if
// terminal; move the player (crash ends the run immediately); then resolve
// each alive foe in index order on the already-updated grid; finally the
// survival win check.
export function tickTron(
  r: SubstrateState,
  w: SubstrateState,
  config: TronConfig,
  rng: RNGState,
  inputs: TronInputs,
): RNGState {
  // (0) Carry scalars; copy the occupancy grid (trails persist).
  w.W = r.W;
  w.H = r.H;
  w.tick = r.tick + 1;
  w.cells.set(r.cells);

  // (1) Already terminal — a fixed point: freeze every field including the
  //     tick counter, so re-running is idempotent and no duplicate input is
  //     recorded past the end.
  if (r.outcome !== "in_progress") {
    w.tick = r.tick;
    w.head_x = r.head_x;
    w.head_y = r.head_y;
    w.heading = r.heading;
    w.alive = r.alive;
    w.outcome = r.outcome;
    w.foes = copyFoes(r.foes);
    return rng;
  }

  // (2) Player move — resolve the held heading (reject 180° reversals),
  //     advance one cell, crash on border / any trail.
  let heading = r.heading;
  if (inputs.desired !== "none" && inputs.desired !== OPPOSITE[r.heading]) {
    heading = inputs.desired;
  }
  w.heading = heading;

  const pd = DELTAS[heading];
  const pnx = r.head_x + pd.dx;
  const pny = r.head_y + pd.dy;
  if (!inBounds(pnx, pny, r.W, r.H) || w.cells[pny * r.W + pnx] !== 0) {
    // Player crashed — the run is over; freeze the foes where they stand.
    w.head_x = r.head_x;
    w.head_y = r.head_y;
    w.alive = 0;
    w.outcome = "lost";
    w.foes = copyFoes(r.foes);
    return rng;
  }
  w.cells[pny * r.W + pnx] = 1;
  w.head_x = pnx;
  w.head_y = pny;
  w.alive = 1;

  // (3) Foes — each alive foe picks a heading (deterministic AI) and moves
  //     on the grid the player and earlier foes have already updated.
  const foes: TronFoe[] = new Array(r.foes.length);
  for (let i = 0; i < r.foes.length; i++) {
    const prev = r.foes[i]!;
    if (prev.alive === 0) {
      foes[i] = { x: prev.x, y: prev.y, heading: prev.heading, alive: 0 };
      continue;
    }
    const behavior = config.foes[i]!.behavior;
    const choice = chooseFoeHeading(prev, behavior, w.head_x, w.head_y, w, rng);
    rng = choice.rng;
    const fd = DELTAS[choice.heading];
    const fnx = prev.x + fd.dx;
    const fny = prev.y + fd.dy;
    if (!inBounds(fnx, fny, r.W, r.H) || w.cells[fny * r.W + fnx] !== 0) {
      // Foe crashed — leave its trail as a permanent wall, drop the cycle.
      foes[i] = { x: prev.x, y: prev.y, heading: choice.heading, alive: 0 };
    } else {
      w.cells[fny * r.W + fnx] = i + 2;
      foes[i] = { x: fnx, y: fny, heading: choice.heading, alive: 1 };
    }
  }
  w.foes = foes;

  // (4) Survival win — reached the target tick alive.
  w.outcome = w.tick >= config.survive_ticks ? "won" : "in_progress";

  return rng;
}

// Pick a foe's next heading. Among its three non-reversal directions, the
// safe ones (in-bounds, empty cell) are the candidates. The decision: roll
// jitter (random safe dir), then aggression (steer toward the player), else
// cruise straight, turning by preference when blocked. rng is threaded so
// the whole thing is replayable.
function chooseFoeHeading(
  foe: TronFoe,
  behavior: TronFoeBehavior,
  px: number,
  py: number,
  w: SubstrateState,
  rng: RNGState,
): { heading: TronDir; rng: RNGState } {
  const back = OPPOSITE[foe.heading];
  const safe = DIRS.filter((d) => d !== back && isSafe(foe.x, foe.y, d, w));
  if (safe.length === 0) return { heading: foe.heading, rng }; // doomed

  // jitter — a random safe direction.
  const j = nextUniform(rng);
  rng = j.rng;
  if (j.value < behavior.jitter) {
    const pick = nextUniform(rng);
    rng = pick.rng;
    const idx = Math.min(safe.length - 1, Math.floor(pick.value * safe.length));
    return { heading: safe[idx]!, rng };
  }

  // aggression — steer toward the player among safe directions.
  const a = nextUniform(rng);
  rng = a.rng;
  if (a.value < behavior.aggression) {
    return { heading: closestTo(safe, foe, px, py), rng };
  }

  // cruise — keep going straight if safe, else turn by preference.
  if (safe.includes(foe.heading)) return { heading: foe.heading, rng };
  return { heading: turnByPref(safe, foe.heading, behavior.turn_pref), rng };
}

// The safe direction whose resulting cell is nearest (Manhattan) to the
// player. Ties resolve to the first in DIRS order — deterministic.
function closestTo(safe: TronDir[], foe: TronFoe, px: number, py: number): TronDir {
  let best = safe[0]!;
  let best_d = Infinity;
  for (const d of safe) {
    const delta = DELTAS[d];
    const dist = Math.abs(foe.x + delta.dx - px) + Math.abs(foe.y + delta.dy - py);
    if (dist < best_d) {
      best_d = dist;
      best = d;
    }
  }
  return best;
}

// When straight is blocked, peel off toward the preferred side first.
function turnByPref(safe: TronDir[], heading: TronDir, pref: "left" | "right"): TronDir {
  const first = pref === "left" ? LEFT_OF[heading] : RIGHT_OF[heading];
  const second = pref === "left" ? RIGHT_OF[heading] : LEFT_OF[heading];
  if (safe.includes(first)) return first;
  if (safe.includes(second)) return second;
  return safe[0]!;
}

function isSafe(x: number, y: number, dir: TronDir, w: SubstrateState): boolean {
  const d = DELTAS[dir];
  const nx = x + d.dx;
  const ny = y + d.dy;
  return inBounds(nx, ny, w.W, w.H) && w.cells[ny * w.W + nx] === 0;
}

function inBounds(x: number, y: number, W: number, H: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H;
}

function copyFoes(foes: TronFoe[]): TronFoe[] {
  return foes.map((f) => ({ x: f.x, y: f.y, heading: f.heading, alive: f.alive }));
}
