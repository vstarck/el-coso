import { expect, test } from "vitest";
import {
  allocSubstrate,
  parseLevel,
  swap,
  tick,
  type FoeFile,
  type LevelFile,
  type SubstrateState,
  type TronInputs,
} from "../src/substrates/tron";
import swarm from "../src/substrates/tron/puzzles/swarm.json";

// Tron engine net. The light-cycle lays a fatal trail; the player steers a
// held heading (Q4 continuous/held); survive to the target tick to win.
// These exercise the four behaviors the tick guarantees: straight-line
// border crash, 180°-reversal rejection, the survival win edge, and
// bit-exact determinism under a scripted input log (the property that makes
// recorded-per-tick-input replay sound).

// Run a scripted input log; return the final read state.
function runScript(
  level: LevelFile,
  inputs: TronInputs[],
): SubstrateState {
  const config = parseLevel(level);
  const substrate = allocSubstrate(config);
  let rng = { seed: 1 };
  for (const input of inputs) {
    rng = tick(substrate, config, rng, input);
    swap(substrate);
  }
  return substrate.read;
}

const NONE: TronInputs = { desired: "none" };

test("drives straight into the border and crashes", () => {
  // start_x 22, heading right, open 44-wide arena. Cells 23..43 fill on
  // ticks 1..21; tick 22 steps to x=44 (out of bounds) → crash.
  const level: LevelFile = { id: "t", W: 44, H: 30, start_x: 22, start_y: 15, start_heading: "right", survive_ticks: 999 };
  const st = runScript(level, Array(22).fill(NONE));
  expect(st.outcome).toBe("lost");
  expect(st.alive).toBe(0);
  expect(st.head_x).toBe(43); // stayed put on the crash tick
  expect(st.tick).toBe(22);
});

test("rejects a 180° reversal into its own trail", () => {
  const level: LevelFile = { id: "t", W: 44, H: 30, start_x: 22, start_y: 15, start_heading: "right", survive_ticks: 999 };
  // Feed the opposite of the current heading — it must be ignored.
  const st = runScript(level, [{ desired: "left" }]);
  expect(st.heading).toBe("right");
  expect(st.head_x).toBe(23); // still moved forward
  expect(st.alive).toBe(1);
});

test("adopts a legal turn", () => {
  const level: LevelFile = { id: "t", W: 44, H: 30, start_x: 22, start_y: 15, start_heading: "right", survive_ticks: 999 };
  const st = runScript(level, [{ desired: "up" }]);
  expect(st.heading).toBe("up");
  expect(st.head_x).toBe(22);
  expect(st.head_y).toBe(14);
});

test("wins on reaching the survival tick alive", () => {
  // survive_ticks 5, open arena, drive straight 5 ticks — stays in bounds.
  const level: LevelFile = { id: "t", W: 44, H: 30, start_x: 22, start_y: 15, start_heading: "right", survive_ticks: 5 };
  const st = runScript(level, Array(5).fill(NONE));
  expect(st.outcome).toBe("won");
  expect(st.alive).toBe(1);
  expect(st.tick).toBe(5);
});

test("freezes once terminal — extra ticks don't change state", () => {
  const level: LevelFile = { id: "t", W: 44, H: 30, start_x: 22, start_y: 15, start_heading: "right", survive_ticks: 5 };
  const won = runScript(level, Array(5).fill(NONE));
  const frozen = runScript(level, Array(9).fill(NONE)); // 4 extra ticks past the win
  expect(frozen.outcome).toBe("won");
  expect(frozen.head_x).toBe(won.head_x);
  expect(frozen.head_y).toBe(won.head_y);
  expect(frozen.tick).toBe(5); // tick does not advance past the terminal edge
});

test("is bit-exact deterministic under a scripted input log", () => {
  const level: LevelFile = { id: "t", W: 30, H: 22, start_x: 4, start_y: 4, start_heading: "right", survive_ticks: 999 };
  // A turning path that stays alive a while.
  const script: TronInputs[] = [];
  const turns = ["right", "down", "left", "down", "right", "down"] as const;
  for (let i = 0; i < 18; i++) {
    script.push({ desired: turns[i % turns.length]! });
  }
  const a = runScript(level, script);
  const b = runScript(level, script);
  expect(hashState(a)).toBe(hashState(b));
  // And lock the trajectory against accidental physics drift.
  expect({ outcome: a.outcome, tick: a.tick, head_x: a.head_x, head_y: a.head_y })
    .toMatchSnapshot();
});

// --- AI foes ---------------------------------------------------------------

// A passive foe (no aggression, no jitter) far from the player cruises
// straight until something blocks it.
function passiveFoe(x: number, y: number, heading: "up" | "down" | "left" | "right"): FoeFile[] {
  return [{ start_x: x, start_y: y, start_heading: heading, aggression: 0, jitter: 0, turn_pref: "right" }];
}

test("a passive foe cruises straight through open space", () => {
  const level: LevelFile = { id: "t", W: 20, H: 20, start_x: 1, start_y: 18, start_heading: "right", survive_ticks: 999, foes: passiveFoe(5, 5, "right") };
  const st = runScript(level, Array(3).fill(NONE));
  expect(st.foes[0]).toEqual({ x: 8, y: 5, heading: "right", alive: 1 });
});

test("a foe turns to avoid the border (turn_pref right)", () => {
  // Foe at (18,5) heading right in a 20-wide arena. Tick 1 → (19,5); tick 2
  // the cell ahead is out of bounds, so it peels off toward its preferred
  // side (right ⇒ down).
  const level: LevelFile = { id: "t", W: 20, H: 20, start_x: 1, start_y: 18, start_heading: "right", survive_ticks: 999, foes: passiveFoe(18, 5, "right") };
  const st = runScript(level, Array(2).fill(NONE));
  expect(st.foes[0]).toEqual({ x: 19, y: 6, heading: "down", alive: 1 });
});

test("the player crashes into a foe's trail", () => {
  // Foe started at (5,5) leaves owner-2 there permanently; the player drives
  // right along row 5 and dies entering that cell on tick 3.
  const level: LevelFile = { id: "t", W: 20, H: 20, start_x: 2, start_y: 5, start_heading: "right", survive_ticks: 999, foes: passiveFoe(5, 5, "right") };
  const st = runScript(level, Array(3).fill(NONE));
  expect(st.outcome).toBe("lost");
  expect(st.tick).toBe(3);
  expect(st.alive).toBe(0);
});

test("foe AI is bit-exact deterministic across all three swarm foes", () => {
  const level = swarm as LevelFile;
  const a = runScript(level, Array(120).fill(NONE));
  const b = runScript(level, Array(120).fill(NONE));
  expect(hashState(a)).toBe(hashState(b));
  expect(a.foes.length).toBe(3);
});

test("parseLevel reads foe count and clamps/defaults behavior", () => {
  const config = parseLevel({ id: "t", W: 20, H: 20, foes: [{ start_x: 3, start_y: 3, aggression: 5, jitter: -1 }] });
  expect(config.foes.length).toBe(1);
  expect(config.foes[0]!.behavior.aggression).toBe(1); // clamped from 5
  expect(config.foes[0]!.behavior.jitter).toBe(0); // clamped from -1
  expect(config.foes[0]!.behavior.turn_pref).toBe("right"); // default
});

function hashState(s: SubstrateState): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.cells.length; i++) {
    h ^= s.cells[i]!;
    h = Math.imul(h, 0x01000193);
  }
  const foes = s.foes.map((f) => `${f.x},${f.y},${f.heading},${f.alive}`).join("|");
  const tail = `${s.tick}:${s.head_x}:${s.head_y}:${s.heading}:${s.outcome}:${foes}`;
  for (let i = 0; i < tail.length; i++) {
    h ^= tail.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
