import { expect, test } from "vitest";
import {
  allocSubstrate,
  parseLevel,
  swap,
  tick,
  type LevelFile,
  type SubstrateState,
} from "../src/substrates/conway";

// Regression net for Conway: each puzzle is run for TICK_COUNT ticks at its
// authored rng_seed; the final cells channel is hashed into a 32-bit FNV-1a
// value. Hashes are locked via inline snapshots. Any drift in B3/S23,
// neighbor accounting, boundary handling, or random-density init changes
// the hash and fails the test.

const TICK_COUNT = 500;

const LEVELS = import.meta.glob<{ default: LevelFile }>(
  "../src/substrates/conway/puzzles/*.json",
  { eager: true },
);

function hashUint8(h: number, arr: Uint8Array): number {
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashState(s: SubstrateState): string {
  let h = 0x811c9dc5;
  h = hashUint8(h, s.cells);
  const tail = `${s.tick}`;
  for (let i = 0; i < tail.length; i++) {
    h ^= tail.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function runHash(level: LevelFile): string {
  const config = parseLevel(level);
  const substrate = allocSubstrate(config);
  let rng = { seed: config.rng_seed };
  for (let t = 0; t < TICK_COUNT; t++) {
    const out = tick(substrate, config, rng);
    rng = out.rng;
    swap(substrate);
  }
  return hashState(substrate.read);
}

const ENTRIES = Object.entries(LEVELS)
  .map(([path, mod]) => ({
    id: (path.split("/").pop() ?? "").replace(/\.json$/, ""),
    level: mod.default,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

test.each(ENTRIES.map((e) => e.id))(
  "%s — 500-tick state hash is stable",
  (puzzle_id) => {
    const entry = ENTRIES.find((e) => e.id === puzzle_id);
    if (!entry) throw new Error(`missing entry for ${puzzle_id}`);
    const hash = runHash(entry.level);
    expect({ puzzle_id, hash }).toMatchSnapshot();
  },
);

// Sanity: glider returns to its initial state after 4·W ticks on a torus,
// because it walks (1, 1) per 4-tick generation cycle on a doubly-wrapped
// W×W grid. Our glider ships at 40×30 — non-square, so the displacement
// returns to origin after lcm(W, H) generations × 4 ticks. We assert a
// simpler invariant: glider population remains at 5 forever.
test("glider — population stays at exactly 5 cells", () => {
  const entry = ENTRIES.find((e) => e.id === "glider");
  if (!entry) throw new Error("glider puzzle missing");
  const config = parseLevel(entry.level);
  const substrate = allocSubstrate(config);
  let rng = { seed: config.rng_seed };
  for (let t = 0; t < 200; t++) {
    const out = tick(substrate, config, rng);
    rng = out.rng;
    swap(substrate);
    let alive = 0;
    for (let i = 0; i < substrate.read.cells.length; i++) {
      alive += substrate.read.cells[i]!;
    }
    expect(alive).toBe(5);
  }
});

// Sanity: blinker oscillates with period 2 — initial state recurs every
// 2 ticks. Lock that explicitly.
test("blinker — initial state recurs every 2 ticks", () => {
  const entry = ENTRIES.find((e) => e.id === "blinker");
  if (!entry) throw new Error("blinker puzzle missing");
  const config = parseLevel(entry.level);
  const substrate = allocSubstrate(config);
  const initial = new Uint8Array(substrate.read.cells);
  let rng = { seed: config.rng_seed };
  for (let cycle = 0; cycle < 10; cycle++) {
    for (let t = 0; t < 2; t++) {
      const out = tick(substrate, config, rng);
      rng = out.rng;
      swap(substrate);
    }
    expect(Array.from(substrate.read.cells)).toEqual(Array.from(initial));
  }
});

// Determinism: random_density seed must produce the same state across two
// independent runs.
test("random-density — bit-equal across two runs", () => {
  const entry = ENTRIES.find((e) => e.id === "random-density");
  if (!entry) throw new Error("random-density puzzle missing");
  const config = parseLevel(entry.level);

  function run(): number[] {
    const substrate = allocSubstrate(config);
    let rng = { seed: config.rng_seed };
    for (let t = 0; t < 100; t++) {
      const out = tick(substrate, config, rng);
      rng = out.rng;
      swap(substrate);
    }
    return Array.from(substrate.read.cells);
  }

  expect(run()).toEqual(run());
});
