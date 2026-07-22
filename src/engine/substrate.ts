import {
  makeEntropyResolve,
  makeRecordResolve,
  makeRngResolve,
  makeVerifyResolve,
} from "./resolver";
import type {
  ResolutionRecord,
  RNGState,
  Substrate,
  SubstrateBundle,
} from "./types";

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

// Delegate one tick to a CLASSIC bundle. Kept for direct callers that know
// their bundle threads RNGState; the spec/27 drivers below subsume it for
// bundles of either shape.
export function tick<State, Config, Inputs>(
  bundle: SubstrateBundle<State, Config, Inputs>,
  substrate: Substrate<State>,
  config: Config,
  rng: RNGState,
  inputs: Inputs,
): RNGState {
  if (!bundle.tick) {
    throw new Error("tick: bundle has no classic `tick` — drive a tickResolve bundle through tickAny/tickReplay (spec/27)");
  }
  return bundle.tick(substrate.read, substrate.write, config, rng, inputs);
}

// Live tick, either bundle shape (spec/27). Classic bundle → bundle.tick,
// records: null. tickResolve bundle → makeRngResolve (or makeEntropyResolve
// when `entropy` is passed — under that backing the returned rng is the
// input rng, vestigial), returns the transcript.
export function tickAny<State, Config, Inputs>(
  bundle: SubstrateBundle<State, Config, Inputs>,
  substrate: Substrate<State>,
  config: Config,
  rng: RNGState,
  inputs: Inputs,
  entropy?: () => number,
): { rng: RNGState; records: ResolutionRecord[] | null } {
  if (bundle.tickResolve) {
    if (entropy) {
      const { resolve, finish } = makeEntropyResolve(entropy);
      bundle.tickResolve(substrate.read, substrate.write, config, resolve, inputs);
      return { rng, records: finish().records };
    }
    const { resolve, finish } = makeRngResolve(rng);
    bundle.tickResolve(substrate.read, substrate.write, config, resolve, inputs);
    const done = finish();
    return { rng: done.rng, records: done.records };
  }
  if (bundle.tick) {
    return {
      rng: bundle.tick(substrate.read, substrate.write, config, rng, inputs),
      records: null,
    };
  }
  throw new Error("tickAny: bundle has neither tick nor tickResolve");
}

// Replay tick (spec/27). Classic bundle → bundle.tick. tickResolve bundle:
//   records given, verify falsy → makeRecordResolve (serve verbatim; the
//                                 record/entropy path)
//   records given, verify true  → makeVerifyResolve (re-derive from rng AND
//                                 compare; throw on drift)
//   records absent              → makeRngResolve (seed re-derivation — the
//                                 Stage A path, and rng-mode forever)
// Drivers derive `verify` from History.resolver_mode === "verify".
export function tickReplay<State, Config, Inputs>(
  bundle: SubstrateBundle<State, Config, Inputs>,
  substrate: Substrate<State>,
  config: Config,
  rng: RNGState,
  inputs: Inputs,
  records: ResolutionRecord[] | null,
  verify?: boolean,
): { rng: RNGState } {
  if (bundle.tickResolve) {
    if (records && verify) {
      const { resolve, finish } = makeVerifyResolve(rng, records);
      bundle.tickResolve(substrate.read, substrate.write, config, resolve, inputs);
      return { rng: finish().rng };
    }
    if (records) {
      const { resolve, finish } = makeRecordResolve(records);
      bundle.tickResolve(substrate.read, substrate.write, config, resolve, inputs);
      finish();
      return { rng };
    }
    const { resolve, finish } = makeRngResolve(rng);
    bundle.tickResolve(substrate.read, substrate.write, config, resolve, inputs);
    return { rng: finish().rng };
  }
  if (bundle.tick) {
    return { rng: bundle.tick(substrate.read, substrate.write, config, rng, inputs) };
  }
  throw new Error("tickReplay: bundle has neither tick nor tickResolve");
}
