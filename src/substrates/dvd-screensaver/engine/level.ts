import type { DvdConfig } from "./config";

// Authoring-flat JSON in, runtime config out. Defaults define a sensible
// classic-DVD scene so a minimal level file (just `id`) still runs.
export type LevelFile = {
  id: string;
  n?: number;
  world_w?: number;
  world_h?: number;
  radius?: number;
  restitution?: number;
  gravity?: number;
  jitter?: number;
  dt?: number;
  projection_horizon?: number;
  rng_seed?: number;
  init_x?: number;
  init_y?: number;
  init_vx?: number;
  init_vy?: number;
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function parseLevel(json: unknown): DvdConfig {
  const o = json as LevelFile;
  const world_w = num(o.world_w, 320);
  const world_h = num(o.world_h, 200);
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    n: num(o.n, 1),
    world_w,
    world_h,
    radius: num(o.radius, 10),
    restitution: num(o.restitution, 1),
    gravity: num(o.gravity, 0),
    jitter: num(o.jitter, 0.03),
    dt: num(o.dt, 1),
    projection_horizon: num(o.projection_horizon, 60),
    rng_seed: num(o.rng_seed, 1),
    init_x: num(o.init_x, world_w * 0.35),
    init_y: num(o.init_y, world_h * 0.45),
    init_vx: num(o.init_vx, 2.1),
    init_vy: num(o.init_vy, 1.3),
  };
}
