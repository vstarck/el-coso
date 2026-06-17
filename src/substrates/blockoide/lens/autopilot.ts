/* Autopilot — a small greedy placement heuristic that plays Blockoide on its
 * own. Its whole job is to look good in an embedded feed post and not lose
 * instantly; it is NOT a strong AI.
 *
 * It is a pure alternative to the keyboard input source: `nextInput(state)`
 * returns one `BlockoideInputs` per tick. Once per piece (keyed on
 * `spawn_count`) it plans the best resting placement by enumerating every
 * orientation × (x, y), dropping each straight down to rest, and scoring the
 * resulting stack with the classic Tetris weights extended to the well's 2D
 * grid of columns (cleared layers reward · aggregate pile · covered holes ·
 * surface bumpiness). Then each tick it nudges the live piece toward that
 * target — spin, then slide, then a short settle, then a hard drop — so the
 * placement reads as a deliberate human move rather than a teleport.
 *
 * It reuses only the engine's pure primitives, so it stays replay-safe and
 * carries no state the substrate doesn't already expose.
 */

import {
  collides,
  landingZ,
  orientCount,
  pieceCells,
  pieceExtent,
  rotateOrient,
  EMPTY,
  WALL,
  type Axis,
  type BlockoideConfig,
  type BlockoideInputs,
  type SubstrateState,
} from "../engine";

const NEUTRAL: BlockoideInputs = {
  move_x: 0,
  move_y: 0,
  rot_x: 0,
  rot_y: 0,
  rot_z: 0,
  soft: false,
  hard: false,
};
const HARD: BlockoideInputs = { ...NEUTRAL, hard: true };

// Scoring weights. Clears pull up hard; covered holes are the deadliest term
// in a small well (they can't be undone), so they outweigh raw pile height.
const W_CLEAR = 3.2; // per completed layer
const W_AGG = -0.36; // per filled level summed over columns (lower pile = better)
const W_HOLES = -1.5; // per empty cell buried under a filled one
const W_BUMP = -0.22; // per unit of height difference between adjacent columns

// Minimum tick spacing between consecutive autopilot inputs (rotation taps,
// slide steps, the hard drop). One tap per tick reads as a blur; pacing every
// action off this single knob makes the play legible and deliberate. At the
// 60 Hz base, 9 ticks ≈ 150 ms between moves.
const ACTION_PERIOD = 18;
// Ticks the piece sits in its planned slot before the hard drop — enough for a
// viewer to register the placement.
const SETTLE_TICKS = 40;
// Hard cap on ticks spent maneuvering one piece before we force the drop; a
// safety net against any pathological stall (blocked rotation / move).
const MAX_PLAN_TICKS = 600;

type Placement = { orient: number; x: number; y: number };

export type Autopilot = {
  nextInput(state: SubstrateState): BlockoideInputs;
  reset(): void;
};

export function makeAutopilot(config: BlockoideConfig): Autopilot {
  const { W, D, H } = config;
  const area = W * D;
  // Reused scratch buffer + per-column surface heights (the well is small).
  const scratch = new Uint8Array(area * H);
  const tops = new Int16Array(area);

  let plannedFor = -1; // spawn_count the current plan belongs to
  let plan: Placement | null = null;
  let ticksOnPlan = 0;
  let settle = 0;
  let cooldown = 0; // ticks until the next input is allowed to fire

  function reset(): void {
    plannedFor = -1;
    plan = null;
    ticksOnPlan = 0;
    settle = 0;
    cooldown = 0;
  }

  // Score the stack that results from stamping (kind, orient) at (px, py, pz).
  function score(
    s: SubstrateState,
    kind: number,
    orient: number,
    px: number,
    py: number,
    pz: number,
  ): number {
    scratch.set(s.cells);
    for (const c of pieceCells(kind, orient)) {
      const z = pz + c.z;
      if (z < 0) return -Infinity; // would lock above the opening — a loss
      scratch[z * area + (py + c.y) * W + (px + c.x)] = kind + 1;
    }

    let agg = 0;
    let holes = 0;
    for (let c = 0; c < area; c++) {
      let top = H;
      for (let z = 0; z < H; z++) {
        if (scratch[z * area + c] !== EMPTY) {
          top = z;
          break;
        }
      }
      tops[c] = top;
      agg += H - top;
      for (let z = top + 1; z < H; z++)
        if (scratch[z * area + c] === EMPTY) holes++;
    }

    let bump = 0;
    for (let y = 0; y < D; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        const t = tops[c]!;
        if (x + 1 < W) bump += Math.abs(t - tops[c + 1]!);
        if (y + 1 < D) bump += Math.abs(t - tops[c + W]!);
      }
    }

    let cleared = 0;
    for (let z = 0; z < H; z++) {
      let full = true;
      let hasPiece = false;
      for (let c = 0; c < area; c++) {
        const v = scratch[z * area + c];
        if (v === EMPTY) {
          full = false;
          break;
        }
        if (v !== WALL) hasPiece = true;
      }
      if (full && hasPiece) cleared++;
    }

    return W_CLEAR * cleared + W_AGG * agg + W_HOLES * holes + W_BUMP * bump;
  }

  // Enumerate every legal resting placement of the current piece and keep the
  // best-scoring one. Returns null only when nothing can be placed (the well
  // is choked at the opening — the run is about to end regardless).
  function computePlan(s: SubstrateState): Placement | null {
    const kind = s.piece_kind;
    let best: Placement | null = null;
    let bestScore = -Infinity;
    const orients = orientCount(kind);
    for (let orient = 0; orient < orients; orient++) {
      const { ex, ey } = pieceExtent(kind, orient);
      for (let px = 0; px <= W - ex; px++) {
        for (let py = 0; py <= D - ey; py++) {
          if (collides(s, kind, orient, px, py, 0)) continue; // blocked at top
          const pz = landingZ(s, kind, orient, px, py, 0);
          const sc = score(s, kind, orient, px, py, pz);
          if (sc > bestScore) {
            bestScore = sc;
            best = { orient, x: px, y: py };
          }
        }
      }
    }
    return best;
  }

  return {
    reset,
    nextInput(s: SubstrateState): BlockoideInputs {
      if (s.piece_kind < 0 || s.outcome !== "in_progress") return NEUTRAL;

      if (s.spawn_count !== plannedFor) {
        plan = computePlan(s);
        plannedFor = s.spawn_count;
        ticksOnPlan = 0;
        settle = SETTLE_TICKS;
      }
      if (!plan) return HARD; // nothing placeable — bail out of this piece

      if (++ticksOnPlan > MAX_PLAN_TICKS) return HARD; // safety net

      // Throttle: hold neutral until the spacing between inputs has elapsed, so
      // each action is its own visible beat rather than a single-tick blur.
      if (cooldown > 0) {
        cooldown--;
        return NEUTRAL;
      }

      // 1. Spin toward the target orientation, one tap at a time. Recomputed
      //    from the live orient each tick so rotation kicks self-correct.
      if (s.orient !== plan.orient) {
        const step = firstRotationStep(s.piece_kind, s.orient, plan.orient);
        if (step) {
          cooldown = ACTION_PERIOD;
          return {
            ...NEUTRAL,
            rot_x: step.axis === "x" ? step.dir : 0,
            rot_y: step.axis === "y" ? step.dir : 0,
            rot_z: step.axis === "z" ? step.dir : 0,
          };
        }
      }

      // 2. Slide toward the target column (both axes at once). A neutral tick
      //    between gated moves resets the engine's auto-repeat, so each emitted
      //    move steps exactly once — the cadence is ACTION_PERIOD, not
      //    move_period.
      const mx = Math.sign(plan.x - s.piece_x);
      const my = Math.sign(plan.y - s.piece_y);
      if (mx !== 0 || my !== 0) {
        cooldown = ACTION_PERIOD;
        return { ...NEUTRAL, move_x: mx, move_y: my };
      }

      // 3. In place — let it settle a beat, then drop.
      if (settle > 0) {
        settle--;
        return NEUTRAL;
      }
      return HARD;
    },
  };
}

// One tap on the shortest rotation path from `from` to `to`, found by BFS over
// the six axis taps (each matches the engine's tryRotate: +1 = one 90° step,
// -1 = three). The orientation set is connected by construction, so a path
// always exists; returns null only when already there.
function firstRotationStep(
  kind: number,
  from: number,
  to: number,
): { axis: Axis; dir: number } | null {
  if (from === to) return null;
  const apply = (o: number, axis: Axis, dir: number): number => {
    let r = o;
    for (let i = 0; i < (dir > 0 ? 1 : 3); i++) r = rotateOrient(kind, r, axis);
    return r;
  };
  const first = new Map<number, { axis: Axis; dir: number }>();
  const seen = new Set<number>([from]);
  const queue: number[] = [from];
  while (queue.length > 0) {
    const o = queue.shift()!;
    for (const axis of ["x", "y", "z"] as Axis[]) {
      for (const dir of [1, -1]) {
        const no = apply(o, axis, dir);
        if (seen.has(no)) continue;
        seen.add(no);
        const step = o === from ? { axis, dir } : first.get(o)!;
        if (no === to) return step;
        first.set(no, step);
        queue.push(no);
      }
    }
  }
  return null;
}
