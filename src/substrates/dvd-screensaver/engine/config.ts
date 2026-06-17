// DVD-screensaver config. A continuous rectangular world plus the Verlet
// physics knobs. `gravity` defaults to 0 (pure DVD bounce); a puzzle flips
// it on to make the acceleration/projection overlays come alive and to
// expose the naive projection's blind spot.
export type DvdConfig = {
  id: string;
  n: number;             // particle count (1 by default; channels are SoA)
  world_w: number;       // continuous world width (world units)
  world_h: number;       // continuous world height
  radius: number;        // particle radius — wall reflection happens at radius
  restitution: number;   // bounce energy retained ∈ [0,1]; 1 = perfect DVD
  gravity: number;       // downward field accel (world units / tick²); 0 = none
  jitter: number;        // stddev of per-tick Gaussian acceleration noise
  dt: number;            // Verlet timestep
  projection_horizon: number; // view param (ticks to project ahead); see spec
  rng_seed: number;
  init_x: number;        // initial position
  init_y: number;
  init_vx: number;       // initial velocity (world units / tick)
  init_vy: number;
};
