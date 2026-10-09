import { describe, it, expect } from "vitest";
import { levelSeed } from "@/history";

// The seed a level asks its history for (S263). The roster-wide reading — every package's every puzzle, through its
// own parseLevel — lives with the private roster (la-cosa dev/kit/level-seed.test.mjs); these rows pin the rule.
describe("levelSeed", () => {
  it("reads rng_seed, then seed, then 1", () => {
    expect(levelSeed({ rng_seed: 9 })).toBe(9);
    expect(levelSeed({ seed: 61 })).toBe(61);
    expect(levelSeed({})).toBe(1);
    expect(levelSeed({ rng_seed: 0 })).toBe(0);           // 0 is a seed, not an absence
    expect(levelSeed({ seed: 0 })).toBe(0);
  });
  it("rng_seed wins over a seed that is not a number (conway's seed is a starting pattern)", () => {
    expect(levelSeed({ rng_seed: 4, seed: { kind: "pattern", cells: [] } })).toBe(4);
    expect(levelSeed({ rng_seed: 4, seed: 4 })).toBe(4);
  });
  it("refuses, naming why — never a default", () => {
    expect(() => levelSeed({ rng_seed: Number.NaN })).toThrow(/rng_seed must be a finite number/);
    expect(() => levelSeed({ rng_seed: "7" })).toThrow(/rng_seed must be a finite number/);
    expect(() => levelSeed({ seed: "7" })).toThrow(/seed must be a finite number when there is no rng_seed/);
    expect(() => levelSeed({ seed: Infinity })).toThrow(/seed must be a finite number/);
    expect(() => levelSeed({ rng_seed: 3, seed: 5 })).toThrow(/two seeds \(rng_seed 3, seed 5\)/);
  });
});
