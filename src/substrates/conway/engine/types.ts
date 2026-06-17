// Conway substrate state. Single channel + scalars. The cells channel is
// doubled (read + write); scalars carry forward via direct field copies in
// tick.

export type SubstrateState = {
  W: number;
  H: number;
  cells: Uint8Array;   // length W*H, row-major (idx = y*W + x). 0 = dead, 1 = alive.
  tick: number;
};

// Conway accepts no per-tick player input. The engine signature still passes
// an inputs object through; the substrate tick ignores it.
export type ConwayInputs = Record<string, never>;
