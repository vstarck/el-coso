import { expect, test } from "vitest";
import {
  allocSubstrate,
  swap,
  tick,
  hashState,
  blockoideBundle,
  type BlockoideConfig,
  type BlockoideInputs,
  type SubstrateState,
} from "../src/substrates/blockoide/engine";
import { makeAutopilot } from "../src/substrates/blockoide/lens/autopilot";

// The autopilot heuristic: it must be deterministic (pure, replay-safe) and
// "good enough not to lose instantly" — it should clear layers and outlast a
// brute hard-drop spam by a wide margin.

const HARD: BlockoideInputs = {
  move_x: 0,
  move_y: 0,
  rot_x: 0,
  rot_y: 0,
  rot_z: 0,
  soft: false,
  hard: true,
};

function cfg(over: Partial<BlockoideConfig> = {}): BlockoideConfig {
  return {
    id: "auto",
    W: 4,
    D: 4,
    H: 14,
    gravity_period: 48,
    soft_factor: 10,
    move_period: 4,
    win_layers: 0,
    walls: [],
    ...over,
  };
}

// Drive a substrate headlessly with the autopilot supplying every input.
function runAutopilot(
  config: BlockoideConfig,
  seed: number,
  ticks: number,
): SubstrateState {
  const substrate = allocSubstrate(config);
  const auto = makeAutopilot(config);
  let rng = { seed };
  for (let i = 0; i < ticks; i++) {
    const input = auto.nextInput(substrate.read);
    rng = tick(substrate, config, rng, input);
    swap(substrate);
    if (substrate.read.outcome !== "in_progress") break;
  }
  return substrate.read;
}

test("autopilot is deterministic: same (config, seed) → identical state", () => {
  const a = runAutopilot(cfg(), 11, 3000);
  const b = runAutopilot(cfg(), 11, 3000);
  expect(hashState(a)).toBe(hashState(b));
  expect(a.tick).toBe(b.tick);
});

test("autopilot clears layers and far outlasts hard-drop spam", () => {
  const config = cfg();
  const spam = allocSubstrate(config);
  let rng = { seed: 11 };
  let spamPieces = 0;
  for (let i = 0; i < 4000; i++) {
    rng = tick(spam, config, rng, HARD);
    swap(spam);
    if (spam.read.outcome !== "in_progress") {
      spamPieces = spam.read.spawn_count;
      break;
    }
  }

  const auto = runAutopilot(config, 11, 8000);
  // It packs cleanly: clears real layers...
  expect(auto.layers).toBeGreaterThanOrEqual(3);
  // ...and survives many more pieces than blind hard-drop spam does.
  expect(auto.spawn_count).toBeGreaterThan(spamPieces * 3);
});
