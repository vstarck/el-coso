import type { RNGState, Substrate, SubstrateBundle } from "./types";

// Build a double-buffered substrate from a bundle + config. The bundle
// owns State allocation (via `alloc`) — channels, plain objects, hybrids,
// remote-seeded snapshots, anything that satisfies `{ read, write }` is
// fair game. The engine just calls `initState` on the read side; the
// first tick is responsible for filling write.
export function allocSubstrate<State, Config, Inputs>(
  bundle: SubstrateBundle<State, Config, Inputs>,
  config: Config,
): Substrate<State> {
  const { read, write } = bundle.alloc(config);
  bundle.initState(read, config);
  return { read, write };
}

// Flip read/write buffers in place.
export function swap<State>(substrate: Substrate<State>): void {
  const tmp = substrate.read;
  substrate.read = substrate.write;
  substrate.write = tmp;
}

// Delegate one tick to the bundle. Engine-side this is a thin pass-through
// — the substrate's `tick` does the substep composition.
export function tick<State, Config, Inputs>(
  bundle: SubstrateBundle<State, Config, Inputs>,
  substrate: Substrate<State>,
  config: Config,
  rng: RNGState,
  inputs: Inputs,
): RNGState {
  return bundle.tick(substrate.read, substrate.write, config, rng, inputs);
}
