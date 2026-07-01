// Julia substrate state — the parameter c of z → z² + c, drifting along an
// orbit. The whole "world" is two floats (c) plus the orbit phase that drives
// them; the fractal itself is computed by the lens (escape-time render), not
// stored. Tiny state ⇒ trivial keyframes, exact replay.
export type SubstrateState = {
  c_re: number; // current Julia parameter, real part
  c_im: number; // current Julia parameter, imaginary part
  phase: number; // orbit phase in radians
  tick: number;
};

// Per-tick injected input — the player's entire action surface (Q4).
// Autonomous world — the player only observes; steering c happens through the
// console command channel, not a recorded per-tick input.
export type JuliaInputs = Record<string, never>;
