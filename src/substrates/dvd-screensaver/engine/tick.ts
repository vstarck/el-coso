import { nextNormal } from "@/engine/rng";
import type { RNGState } from "@/engine/types";
import type { DvdConfig } from "./config";
import type { DvdInputs, SubstrateState } from "./types";

// One Verlet step + wall reflection for a single particle. Pure: no RNG, no
// state mutation — takes the current/previous position and a field
// acceleration, returns the next position and the rebuilt previous position.
//
// Exported so a future *physics-aware* projection strategy can forward-
// simulate by reusing the exact substrate physics (called with the field
// accel but jitter disabled). Lens → engine imports are allowed; the
// forbidden direction is engine → lens.
//
// Displacement form: velocity is the implicit `pos − prev`. We reflect the
// step displacement against the walls (mirror position, reverse + damp by
// restitution) and rebuild `prev` so the next step's implicit velocity
// equals the reflected displacement.
export function integrateAndReflect(
  x: number,
  y: number,
  prevx: number,
  prevy: number,
  ax: number,
  ay: number,
  config: DvdConfig,
): { nx: number; ny: number; npx: number; npy: number } {
  const dt2 = config.dt * config.dt;
  const e = config.restitution;
  const r = config.radius;
  const lo_x = r;
  const hi_x = config.world_w - r;
  const lo_y = r;
  const hi_y = config.world_h - r;

  let vx = x - prevx + ax * dt2;
  let vy = y - prevy + ay * dt2;
  let nx = x + vx;
  let ny = y + vy;

  if (nx < lo_x) {
    nx = 2 * lo_x - nx;
    vx = -vx * e;
  } else if (nx > hi_x) {
    nx = 2 * hi_x - nx;
    vx = -vx * e;
  }
  if (ny < lo_y) {
    ny = 2 * lo_y - ny;
    vy = -vy * e;
  } else if (ny > hi_y) {
    ny = 2 * hi_y - ny;
    vy = -vy * e;
  }

  // Guard pathological overshoot (very fast particle in a small box).
  if (nx < lo_x) nx = lo_x;
  else if (nx > hi_x) nx = hi_x;
  if (ny < lo_y) ny = lo_y;
  else if (ny > hi_y) ny = hi_y;

  return { nx, ny, npx: nx - vx, npy: ny - vy };
}

// Tick: advance every particle one Verlet step. Field acceleration is
// gravity (down) + a per-tick Gaussian jitter drawn from the threaded RNG.
// Wall bounces are impulsive (the reflection above), so they are NOT folded
// into the emitted `ax/ay` — that channel is the continuous field only.
export function tickDvd(
  r: SubstrateState,
  w: SubstrateState,
  config: DvdConfig,
  rng: RNGState,
  _inputs: DvdInputs,
): RNGState {
  w.n = r.n;
  w.world_w = r.world_w;
  w.world_h = r.world_h;
  w.tick = r.tick + 1;

  for (let i = 0; i < r.n; i++) {
    const x = r.px[i] ?? 0;
    const y = r.py[i] ?? 0;
    const prevx = r.ppx[i] ?? 0;
    const prevy = r.ppy[i] ?? 0;

    let jxi = 0;
    let jyi = 0;
    if (config.jitter > 0) {
      const a = nextNormal(rng);
      jxi = a.value * config.jitter;
      rng = a.rng;
      const b = nextNormal(rng);
      jyi = b.value * config.jitter;
      rng = b.rng;
    }

    const axi = jxi;
    const ayi = config.gravity + jyi;
    const step = integrateAndReflect(x, y, prevx, prevy, axi, ayi, config);

    w.px[i] = step.nx;
    w.py[i] = step.ny;
    w.ppx[i] = step.npx;
    w.ppy[i] = step.npy;
    w.ax[i] = axi;
    w.ay[i] = ayi;
    w.jx[i] = jxi;
    w.jy[i] = jyi;
  }

  return rng;
}
