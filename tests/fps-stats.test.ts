import { describe, expect, it } from "vitest";
import { makeFpsStats } from "../src/lib/lens-host/fps-stats";

describe("makeFpsStats", () => {
  it("reports steady 60fps from steady 16.67ms frames", () => {
    const s = makeFpsStats();
    for (let i = 0; i < 120; i++) s.sample(1000 / 60);
    const r = s.read();
    expect(r.instant).toBeCloseTo(60, 0);
    expect(r.averageTotal).toBeCloseTo(60, 0);
    expect(r.average10s).toBeCloseTo(60, 0);
    expect(r.min10s).toBeCloseTo(60, 0);
  });

  it("min10s catches a single bad frame the averages smear away", () => {
    const s = makeFpsStats();
    for (let i = 0; i < 300; i++) s.sample(1000 / 60); // ~5s @ 60
    s.sample(100); // one 10fps hitch
    for (let i = 0; i < 60; i++) s.sample(1000 / 60);
    const r = s.read();
    expect(r.min10s).toBeCloseTo(10, 0); // 1000/100ms
    expect(r.average10s).toBeGreaterThan(55); // the hitch barely moves the mean
    expect(r.instant).toBeCloseTo(60, 0); // and is gone from the live readout
  });

  it("averageTotal spans the whole run; average10s only the last 10s", () => {
    const s = makeFpsStats();
    // 12s at 30fps, then 4s at 60fps.
    for (let i = 0; i < 12 * 30; i++) s.sample(1000 / 30);
    for (let i = 0; i < 4 * 60; i++) s.sample(1000 / 60);
    const r = s.read();
    // last 10s is mostly the 60fps tail (4s @60) + 6s @30 ⇒ between 30 and 60.
    expect(r.average10s).toBeGreaterThan(38);
    expect(r.average10s).toBeLessThan(52);
    // total run (16s) is dominated by the 30fps stretch ⇒ closer to 30.
    expect(r.averageTotal).toBeGreaterThan(30);
    expect(r.averageTotal).toBeLessThan(40);
  });

  it("ignores non-positive deltas and resets cleanly", () => {
    const s = makeFpsStats();
    s.sample(0);
    s.sample(-5);
    s.sample(NaN);
    expect(s.read().averageTotal).toBe(0);
    for (let i = 0; i < 60; i++) s.sample(1000 / 60);
    expect(s.read().averageTotal).toBeCloseTo(60, 0);
    s.reset();
    expect(s.read()).toEqual({ instant: 0, averageTotal: 0, average10s: 0, min10s: 0 });
  });
});
