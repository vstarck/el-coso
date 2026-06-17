import { describe, it, expect } from "vitest";
import {
  allocSubstrate,
  swap,
  tick,
  parseLevel,
  type RNGState,
  type TtsInputs,
} from "@/substrates/tts";
import { chooseMove, type AutoMove } from "@/substrates/tts/lens/autopilot";
import { nextRange } from "@/engine/rng";

// Mirrors the lens's paced autopilot: jittered delay between actions, jitter
// drawn from an engine-PRNG stream seeded off the run (see lens/index.ts).
const AUTO_DELAY_BASE = 3;
const AUTO_DELAY_JITTER = 5;

function playAutoPaced(seed: number, ticks: number) {
  const cfg = parseLevel({
    id: "paced",
    W: 10,
    H: 20,
    gravity_period: 30,
    move_period: 6,
  });
  const sub = allocSubstrate(cfg);
  let rng: RNGState = { seed };
  let target: AutoMove | null = null;
  let for_spawn = -1;
  let cooldown = 0;
  let auto_rng: RNGState = { seed: (seed + 0x9e3779b9) >>> 0 };

  for (let i = 0; i < ticks && sub.read.outcome === "in_progress"; i++) {
    const s = sub.read;
    let input: TtsInputs = { move: 0, rotate: 0, drop: false };
    if (s.piece_kind >= 0) {
      if (s.spawn_count !== for_spawn || target === null) {
        target = chooseMove(s);
        for_spawn = s.spawn_count;
      }
      if (cooldown > 0) {
        cooldown -= 1;
      } else if (!target) {
        input = { move: 0, rotate: 0, drop: true };
      } else {
        if (s.piece_rot !== target.rot) input = { move: 0, rotate: 1, drop: false };
        else if (s.piece_x < target.x) input = { move: 1, rotate: 0, drop: false };
        else if (s.piece_x > target.x) input = { move: -1, rotate: 0, drop: false };
        else input = { move: 0, rotate: 0, drop: true };
        const draw = nextRange(auto_rng, 0, AUTO_DELAY_JITTER + 1);
        auto_rng = draw.rng;
        cooldown = AUTO_DELAY_BASE + Math.floor(draw.value);
      }
    }
    rng = tick(sub, cfg, rng, input);
    swap(sub);
  }
  return sub.read;
}

// Drive the engine with the same steering the lens uses under `auto`: pick a
// landing once per piece, then rotate / slide / drop toward it. Gravity is set
// near-off so the run isolates the heuristic's placement quality.
function playAuto(seed: number, ticks: number) {
  const cfg = parseLevel({
    id: "auto",
    W: 10,
    H: 20,
    gravity_period: 1000,
    move_period: 1,
  });
  const sub = allocSubstrate(cfg);
  let rng: RNGState = { seed };
  let target: AutoMove | null = null;
  let for_spawn = -1;

  for (let i = 0; i < ticks && sub.read.outcome === "in_progress"; i++) {
    const s = sub.read;
    let input: TtsInputs = { move: 0, rotate: 0, drop: false };
    if (s.piece_kind >= 0) {
      if (s.spawn_count !== for_spawn || target === null) {
        target = chooseMove(s);
        for_spawn = s.spawn_count;
      }
      if (!target) input = { move: 0, rotate: 0, drop: true };
      else if (s.piece_rot !== target.rot) input = { move: 0, rotate: 1, drop: false };
      else if (s.piece_x < target.x) input = { move: 1, rotate: 0, drop: false };
      else if (s.piece_x > target.x) input = { move: -1, rotate: 0, drop: false };
      else input = { move: 0, rotate: 0, drop: true };
    }
    rng = tick(sub, cfg, rng, input);
    swap(sub);
  }
  return sub.read;
}

describe("tts autopilot", () => {
  it("plays a long, line-clearing game without topping out", () => {
    const s = playAuto(5, 4000);
    expect(s.outcome).toBe("in_progress"); // still alive after 4000 ticks
    expect(s.spawn_count).toBeGreaterThan(80);
    expect(s.lines).toBeGreaterThan(15);
  });

  it("is deterministic for a given seed", () => {
    const a = playAuto(9, 1500);
    const b = playAuto(9, 1500);
    expect(a.lines).toBe(b.lines);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  it("paced (jittered-delay) play still clears lines and survives a while", () => {
    const s = playAutoPaced(5, 4000);
    expect(s.spawn_count).toBeGreaterThan(40);
    expect(s.lines).toBeGreaterThan(3);
  });

  it("the paced run is deterministic (jitter from the engine PRNG)", () => {
    const a = playAutoPaced(9, 2000);
    const b = playAutoPaced(9, 2000);
    expect(a.lines).toBe(b.lines);
    expect(a.spawn_count).toBe(b.spawn_count);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  it("chooseMove returns a placeable target on an empty board", () => {
    const s = playAuto(1, 1); // one tick → first piece spawned
    const move = chooseMove(s);
    expect(move).not.toBeNull();
    expect(move!.rot).toBeGreaterThanOrEqual(0);
    expect(move!.rot).toBeLessThan(4);
    expect(move!.x).toBeGreaterThanOrEqual(0);
    expect(move!.x).toBeLessThan(s.W);
  });
});
