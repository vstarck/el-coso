// DVD-screensaver substrate state. A Verlet particle: the ONLY stored
// dynamics are position + previous position. Velocity (pos − prev) and
// acceleration (second difference) are deliberately NOT stored — each lens
// reconstructs the hidden quantity it visualizes. That minimality is the
// demo: no magic, every overlay is a pure function of these two positions.
//
// `ax/ay/jx/jy` are observables the tick *emits* (recomputed every tick),
// not stored dynamics — the jitter is generated inside the tick from the
// RNG and a lens can't recompute it, so the substrate publishes it.
//
// Naming: `SubstrateState` rather than `DvdState` to mirror the per-package
// convention (cross-package callers refer to it through the barrel).
export type SubstrateState = {
  n: number;
  world_w: number;
  world_h: number;
  px: Float32Array;   // position x
  py: Float32Array;   // position y
  ppx: Float32Array;  // previous position x (Verlet)
  ppy: Float32Array;  // previous position y (Verlet)
  ax: Float32Array;   // net FIELD acceleration applied this tick (observable)
  ay: Float32Array;
  jx: Float32Array;   // jitter component of acceleration this tick (observable)
  jy: Float32Array;
  tick: number;
};

// Zero substrate input — the screensaver is autonomous like Conway. The
// only user action is recomposing lenses via the HUD, which is view-state
// and never reaches the substrate.
export type DvdInputs = {
  // intentionally empty
};
