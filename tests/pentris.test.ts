import { expect, test } from "vitest";
import { runHeadless } from "../src/engine/headless";
import {
  allocSubstrate,
  swap,
  tick,
  hashState,
  pentrisBundle,
  pentrisBttfAdapter,
  type PentrisConfig,
  type PentrisInputs,
} from "../src/substrates/pentris";

// Pentris regression net: determinism (two identical headless runs match),
// the stacker's basic physics (hard-drop spam tops out; a crafted I-drop
// clears a line), and the content-hash address semantics (equal
// configurations pinch; clock fields don't split them).

const NEUTRAL: PentrisInputs = { move: 0, rotate: 0, soft: false, hard: false };
const HARD: PentrisInputs = { move: 0, rotate: 0, soft: false, hard: true };

function cfg(over: Partial<PentrisConfig> = {}): PentrisConfig {
  return {
    id: "test",
    W: 12,
    H: 22,
    gravity_period: 48,
    soft_factor: 10,
    move_period: 5,
    win_lines: 0,
    ...over,
  };
}

// A deterministic, input-shaped script: held moves, taps, soft and hard
// drops on co-prime periods, so every code path gets exercised.
function script(n: number): PentrisInputs[] {
  const out: PentrisInputs[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      move: i % 7 === 0 ? -1 : i % 11 === 0 ? 1 : 0,
      rotate: i % 17 === 0 ? 1 : i % 29 === 0 ? -1 : 0,
      soft: i % 5 === 0,
      hard: i % 23 === 0,
    });
  }
  return out;
}

test("determinism: same (config, seed, inputs) → identical state", () => {
  const a = runHeadless(pentrisBundle, cfg(), 7, script(500));
  const b = runHeadless(pentrisBundle, cfg(), 7, script(500));
  expect(hashState(a)).toBe(hashState(b));
  expect(a.tick).toBe(500);
  expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
});

test("golden snapshot: scripted run lands on the recorded hash", () => {
  const s = runHeadless(pentrisBundle, cfg(), 7, script(500));
  expect(s.spawn_count).toBeGreaterThan(5); // the script really plays
  expect(hashState(s)).toBe("f817b3ce");
});

test("hard-drop spam stacks pieces and tops out", () => {
  // No steering ⇒ every piece lands dead-center; the tower tops out after
  // a handful of pieces (22 rows ÷ ~2.5 rows per locked pentomino).
  const s = runHeadless(pentrisBundle, cfg(), 3, Array(400).fill(HARD));
  expect(s.outcome).toBe("lost");
  expect(s.spawn_count).toBeGreaterThan(5);
});

test("a vertical I drop completes and clears the bottom row", () => {
  const config = cfg();
  const substrate = allocSubstrate(config); // initState runs inside
  const s = substrate.read;
  // Bottom row full except column 0…
  for (let x = 1; x < config.W; x++) {
    s.cells[(config.H - 1) * config.W + x] = 5;
  }
  // …and a vertical I (kind 1, rot 1) hovering over the gap.
  s.piece_kind = 1;
  s.piece_rot = 1;
  s.piece_x = 0;
  s.piece_y = 0;
  s.next_kind = 0;
  s.spawn_count = 1;

  tick(substrate, config, { seed: 1 }, HARD);
  swap(substrate);
  const after = substrate.read;

  expect(after.lines).toBe(1);
  expect(after.spawn_count).toBe(2); // the next piece spawned
  // The cleared row refilled only by the shifted I remainder at column 0.
  for (let x = 1; x < config.W; x++) {
    expect(after.cells[(config.H - 1) * config.W + x]).toBe(0);
  }
  // Four I cells remain in column 0 (five dropped, one cleared with the row).
  let col0 = 0;
  for (let y = 0; y < config.H; y++) {
    if ((after.cells[y * config.W + 0] ?? 0) !== 0) col0++;
  }
  expect(col0).toBe(4);
});

test("hash is a configuration address: clock fields don't split it", () => {
  const config = cfg();
  const a = allocSubstrate(config).read;
  const b = allocSubstrate(config).read;
  expect(hashState(a)).toBe(hashState(b)); // identical states pinch
  b.tick = 999;
  b.drop_acc = 17;
  b.move_cooldown = 3;
  b.spawn_count = 12;
  expect(hashState(b)).toBe(hashState(a)); // clock-ish fields excluded
  b.cells[0] = 1;
  expect(hashState(b)).not.toBe(hashState(a)); // content splits it
});

test("commits are placements: the first spawn mints none, a lock mints one", () => {
  const config = cfg();
  // First-spawn tick: piece_kind was -1, nothing locked yet → no commit.
  const a = allocSubstrate(config).read;
  const b = allocSubstrate(config).read;
  b.tick = 1;
  b.spawn_count = 1;
  b.piece_kind = 3;
  b.next_kind = 5;
  expect(pentrisBttfAdapter.commit_predicate(a, b, NEUTRAL)).toBeNull();

  // A placement: L (kind 2) locks, clearing two rows; W (kind 8) enters.
  const before = allocSubstrate(config).read;
  const after = allocSubstrate(config).read;
  before.tick = 100;
  before.piece_kind = 2;
  before.spawn_count = 4;
  before.lines = 1;
  after.tick = 101;
  after.piece_kind = 8;
  after.spawn_count = 5;
  after.lines = 3;
  const payload = pentrisBttfAdapter.commit_predicate(before, after, HARD);
  expect(payload).not.toBeNull();
  expect(payload!.piece).toBe("L"); // the glyph shows what was PLACED
  expect(payload!.falling).toBe("W");
  expect(payload!.cleared).toBe(2);
});

test("gravity alone eventually tops out an unattended run", () => {
  // gravity_period 2 ⇒ a piece falls a row every other tick. With no
  // steering the center tower reaches the spawn row on its own — the
  // substrate ends the run without any player input ever arriving.
  const s = runHeadless(
    pentrisBundle,
    cfg({ gravity_period: 2 }),
    11,
    Array(1500).fill(NEUTRAL),
  );
  expect(s.spawn_count).toBeGreaterThan(3);
  expect(s.outcome).toBe("lost");
});
