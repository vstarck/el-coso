// Generic engine types. The engine's job: drive `(State, Causality) → next
// State` via double-buffered State + a tick function. State shape is
// opaque to the engine — substrates choose their own representation
// (channels via `engine/channels.ts`, plain objects, hybrid, etc.).

export type RNGState = {
  seed: number;
};

// --- resolver seam (spec/27) ----------------------------------------------
//
// The substrate-facing face of chance. Constructed by the driver, opaque to
// the bundle: the same signature is served by threaded RNG, a recorded
// transcript, or injected entropy, and the bundle cannot tell which.
export type Resolve = (tag: string, opts?: ResolveOpts) => number;

export type ResolveOpts = {
  // Draw kind — at most one of the following four (0 or 1):
  weights?: number[]; // categorical; returns an INDEX into weights
  arity?: number; // sugar: `arity` equal weights; returns index
  range?: [number, number]; // uniform in [lo, hi); nextRange-compatible
  normal?: true; // Box–Muller; nextNormal-compatible
  // Levers:
  force?: number; // bypass the draw; return this value. Draws are
  //                 still consumed (stream alignment).
  note?: unknown; // opaque, copied into the record. Keep it small and
  //                plain-data (it is retained in the input log for the
  //                branch's lifetime).
};

export type ResolutionKind = "u" | "index" | "range" | "normal";

// One minted answer. `value` is the FROZEN, meaningful result (index for
// weights/arity; shaped value for range/normal; u otherwise) — never a raw
// uniform a later refactor could reinterpret.
export type ResolutionRecord = {
  tag: string;
  kind: ResolutionKind;
  value: number;
  forced?: true;
  note?: unknown;
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
//   alloc       — produce the read/write State pair. The engine never
//                 touches State internals; it just holds two references.
//   initState   — populate the read-side State once at startup. The first
//                 tick is responsible for filling the write side.
//   tick        — classic pure step: read current State, write next State,
//                 return updated RNG. The engine swaps read/write after
//                 the call.
//   tickResolve — resolver-seam step (spec/27): same step, but every
//                 nondeterministic outcome goes through the injected
//                 `resolve` instead of threading RNGState directly. The
//                 backing behind `resolve` is the driver's business.
//
// At least one of tick / tickResolve must be present (checked at the
// driver); when both are, drivers use tickResolve.
export type SubstrateBundle<State, Config, Inputs> = {
  alloc: (config: Config) => { read: State; write: State };
  initState: (state: State, config: Config) => void;
  tick?: (
    read: State,
    write: State,
    config: Config,
    rng: RNGState,
    inputs: Inputs,
  ) => RNGState;
  tickResolve?: (
    read: State,
    write: State,
    config: Config,
    resolve: Resolve,
    inputs: Inputs,
  ) => void;
};

// Double-buffered substrate handle. `read` is the current frame (input to
// the next tick); `write` is the next frame (output). `swap` flips them.
export type Substrate<State> = {
  read: State;
  write: State;
};
