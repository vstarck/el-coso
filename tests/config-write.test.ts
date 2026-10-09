import { describe, expect, it } from "vitest";
import { checkConfigWrites, checkTunableValue, planMountTunables } from "@/lenses/config-write";
import type { LensTunable } from "@/lenses/types";

// Config-target writes, checked (S263). The substrate-specific halves (rgba's stability bound, every shipped puzzle
// passing its own checkConfig) are gated with the substrates: la-cosa substrates/rgba/tests/rgba-config-write.test.ts,
// dev/kit/config-check.test.mjs.
const knob = (id: string, path: string[], extra: Partial<LensTunable> = {}): LensTunable =>
  ({ id, label: id, group: "g", type: "float", min: 0, max: 1, step: 0.1, target: "config", path, ...extra }) as LensTunable;
const A = knob("a", ["phys", "a"]);
const B = knob("b", ["phys", "b"]);
const N = knob("n", ["phys", "n"], { type: "int", min: 1, max: 9, step: 1 } as Partial<LensTunable>);
const E = knob("e", ["mode"], { type: "enum", options: ["x", "y"] } as Partial<LensTunable>);
const L = { ...knob("l", ["look"]), target: "lens" } as LensTunable;
const level = () => ({ phys: { a: 0.2, b: 0.2, n: 3 }, mode: "x", big: new Float32Array(4) });

describe("checkTunableValue — the declaration", () => {
  it("refuses, naming why", () => {
    expect(() => checkTunableValue(A, 5)).toThrow(/^a = 5 is outside 0…1$/);
    expect(() => checkTunableValue(A, Number.NaN)).toThrow(/a needs a finite number/);
    expect(() => checkTunableValue(A, "0.5")).toThrow(/a needs a finite number/);
    expect(() => checkTunableValue(N, 4.5)).toThrow(/n must be a whole number/);
    expect(() => checkTunableValue(E, "z")).toThrow(/e must be one of x, y/);
  });
  it("passes a legal value of each type", () => {
    expect(() => { checkTunableValue(A, 1); checkTunableValue(N, 9); checkTunableValue(E, "y"); }).not.toThrow();
  });
});

describe("checkConfigWrites — a batch judged where it lands", () => {
  const sumBelowHalf = (c: { phys: { a: number; b: number } }) => {
    if (c.phys.a + c.phys.b > 0.5) throw new Error(`a + b = ${c.phys.a + c.phys.b} > 0.5`);
  };
  it("never creates a path, and never touches the input", () => {
    const c = level(), before = JSON.stringify(c);
    expect(() => checkConfigWrites(c, [{ tunable: knob("z", ["phys", "z"]), value: 0.1 }])).toThrow(/this level has no phys\.z/);
    expect(() => checkConfigWrites(c, [{ tunable: knob("q", ["nowhere", "q"]), value: 0.1 }])).toThrow(/this level has no nowhere$/);
    const out = checkConfigWrites(c, [{ tunable: A, value: 0.3 }]);
    expect(JSON.stringify(c), "the input is untouched").toBe(before);
    expect(out.phys.a).toBe(0.3);
    expect(out.big, "objects off the written path are shared, not cloned").toBe(c.big);
  });
  it("runs the hook on the LANDING config, once", () => {
    let calls = 0;
    const hook = (x: { phys: { a: number; b: number } }) => { calls++; sumBelowHalf(x); };
    // a 0.2→0.1 then b 0.2→0.4: b alone over the live a (0.2 + 0.4) would fail; together they land at 0.5
    expect(() => checkConfigWrites(level(), [{ tunable: B, value: 0.4 }, { tunable: A, value: 0.1 }], hook)).not.toThrow();
    expect(calls).toBe(1);
    expect(() => checkConfigWrites(level(), [{ tunable: B, value: 0.4 }], sumBelowHalf)).toThrow(/a \+ b = 0\.6/);
  });
  it("refuses a hook that RETURNS (a checker of the same name with another contract)", () => {
    expect(() => checkConfigWrites(level(), [{ tunable: A, value: 0.1 }], () => "a refusal as a string")).toThrow(/must throw or return nothing; it returned "a refusal as a string"/);
  });
  it("refuses a lens-target tunable", () => {
    expect(() => checkConfigWrites(level(), [{ tunable: L, value: 0.1 }])).toThrow(/l is a lens tunable/);
  });
});

describe("planMountTunables — the embed's mount-time tunables", () => {
  it("splits, checks the config half as one batch, refuses an undeclared key", () => {
    const p = planMountTunables("lab", [A, B, L], level(), { "phys.a": 0.4, look: 0.7 });
    expect(p.level.phys.a).toBe(0.4);
    expect(p.lens).toEqual([{ path: ["look"], value: 0.7 }]);
    expect(() => planMountTunables("lab", [A, L], level(), { "phys.nope": 0.1 })).toThrow(/lens "lab" has no tunable "phys\.nope" \(declared: phys\.a, look\)/);
    expect(() => planMountTunables("lab", [A], level(), { "phys.a": 5 })).toThrow(/a = 5 is outside/);
  });
});
