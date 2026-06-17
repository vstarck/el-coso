import { expect, test } from "vitest";
import { runHeadless } from "../src/engine";
import { bundle, parseLevel, type LevelFile, type TronInputs } from "../src/substrates/tron";

// The generic headless runner: bundle + config + seed + one-input-per-tick →
// final State. The terminal outcome lives on the returned State, so a
// headless run *is* the win/lose check — no chrome, no history layer. Tron is
// the worked example (it has a clean win/lose outcome and a deterministic
// rng-threaded foe AI).

const NONE: TronInputs = { desired: "none" };
const OPEN: LevelFile = {
  id: "h", W: 44, H: 30, start_x: 22, start_y: 15, start_heading: "right", survive_ticks: 5,
};

test("a winning input stream reaches outcome=won, readable off State", () => {
  const config = parseLevel(OPEN);
  // survive_ticks 5, drive straight 5 ticks → in bounds → survives.
  const final = runHeadless(bundle, config, 1, Array(5).fill(NONE));
  expect(final.outcome).toBe("won");
  expect(final.tick).toBe(5);
});

test("a crashing input stream reaches outcome=lost", () => {
  // survive 999 but only a 6-wide arena: driving right crashes into the border.
  const config = parseLevel({ ...OPEN, W: 6, start_x: 2, survive_ticks: 999 });
  const final = runHeadless(bundle, config, 1, Array(10).fill(NONE));
  expect(final.outcome).toBe("lost");
});

test("same (config, seed, inputs) → byte-identical State (determinism)", () => {
  // A swarm puzzle exercises the rng-threaded foe AI, so this also pins the
  // RNG threading.
  const config = parseLevel({ ...OPEN, survive_ticks: 999 });
  const a = runHeadless(bundle, config, 7, Array(60).fill(NONE));
  const b = runHeadless(bundle, config, 7, Array(60).fill(NONE));
  expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  expect(a.head_x).toBe(b.head_x);
  expect(a.tick).toBe(b.tick);
});
