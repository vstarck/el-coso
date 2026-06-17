import type { ChannelBag } from "@/engine/channels";
import type { RNGState } from "@/engine/types";
import { nextUniform } from "@/engine/rng";

import type { ConwayConfig } from "./config";
import type { SubstrateState } from "./types";

export function makeState(bag: ChannelBag, config: ConwayConfig): SubstrateState {
  const cells = bag.cells;
  if (!(cells instanceof Uint8Array)) {
    throw new Error("channel 'cells' missing or not Uint8Array");
  }
  return {
    W: config.W,
    H: config.H,
    cells,
    tick: 0,
  };
}

// Populate the initial cells buffer from the seed pattern. Called once on the
// read buffer at allocation time; the doubled write buffer starts zeroed and
// is filled by the first tick.
export function initState(state: SubstrateState, config: ConwayConfig): void {
  const cells = state.cells;
  const W = config.W;
  const H = config.H;
  cells.fill(0);

  const seed = config.seed;
  if (seed.kind === "pattern") {
    const pairs = seed.cells;
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const x = pairs[i]!;
      const y = pairs[i + 1]!;
      if (x >= 0 && x < W && y >= 0 && y < H) {
        cells[y * W + x] = 1;
      }
    }
    return;
  }

  if (seed.kind === "ascii") {
    const rows = seed.rows;
    for (let y = 0; y < H && y < rows.length; y++) {
      const row = rows[y] ?? "";
      for (let x = 0; x < W && x < row.length; x++) {
        if (row[x] === "O") cells[y * W + x] = 1;
      }
    }
    return;
  }

  // random_density — RNG-seeded init. One uniform draw per cell, alive iff
  // value < density. Determinism: same rng_seed → same initial population.
  let rng: RNGState = { seed: config.rng_seed };
  const density = clamp01(seed.density);
  for (let i = 0; i < cells.length; i++) {
    const out = nextUniform(rng);
    rng = out.rng;
    cells[i] = out.value < density ? 1 : 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
