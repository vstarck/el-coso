// Example substrate state. Minimal shape — a single counter array the tick
// increments per cell. Replace with the substrate's real channels when
// authoring a new substrate package.
//
// Naming: `SubstrateState` rather than `ExampleState` to mirror a real substrate's
// internal convention (each substrate names its state struct
// `SubstrateState` *locally*; cross-package callers refer to it through
// the substrate package, e.g. `import type { SubstrateState } from "../substrates/example"`).
export type SubstrateState = {
  W: number;
  H: number;
  counter: Float32Array;  // per-cell counter incremented each tick
  tick: number;
};

// Per-tick injected inputs the substrate's tick consumes. The no-op
// example has none. Real substrates fill this with their input shape
// (e.g. `{ new_biases: Bias[] }`).
export type ExampleInputs = {
  // Placeholder. Add real injected-input fields here.
};
