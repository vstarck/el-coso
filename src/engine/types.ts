// Generic engine types. The engine's job: drive `(State, Causality) → next
// State` via double-buffered State + a tick function. State shape is
// opaque to the engine — substrates choose their own representation
// (channels via `engine/channels.ts`, plain objects, hybrid, etc.).

export type RNGState = {
  seed: number;
};

// A substrate package implements this lifecycle. The engine consumes it.
//
//   State   — substrate-specific state struct. Shape is up to the
//             substrate; performance-critical substrates compose
//             `channelAlloc` from `engine/channels.ts` for typed-array
//             SoA, but plain objects (and hybrids) are equally valid.
//   Config  — substrate-specific puzzle/level configuration (parsed shape)
//   Inputs  — per-tick injected inputs (e.g. a placed edit, or which
//             cell the player clicked)
//
// Hooks:
//   alloc     — produce the read/write State pair. The engine never
//               touches State internals; it just holds two references.
//   initState — populate the read-side State once at startup. The first
//               tick is responsible for filling the write side.
//   tick      — pure step: read current State, write next State, return
//               updated RNG. The engine swaps read/write after the call.
export type SubstrateBundle<State, Config, Inputs> = {
  alloc: (config: Config) => { read: State; write: State };
  initState: (state: State, config: Config) => void;
  tick: (
    read: State,
    write: State,
    config: Config,
    rng: RNGState,
    inputs: Inputs,
  ) => RNGState;
};

// Double-buffered substrate handle. `read` is the current frame (input to
// the next tick); `write` is the next frame (output). `swap` flips them.
export type Substrate<State> = {
  read: State;
  write: State;
};
