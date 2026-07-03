import { describe, expect, it } from "vitest";
import {
  allocSubstrate,
  parseLevel,
  swap,
  tick,
  type AbismoConfig,
} from "../src/substrates/abismo";
import type { RNGState } from "../src/engine/types";

const cfg = (over: Record<string, unknown> = {}): AbismoConfig =>
  parseLevel({ id: "test", depth_max: 5, dive_speed: 0.02, ...over });

function step(sub: ReturnType<typeof allocSubstrate>, c: AbismoConfig, scrollDelta: number): void {
  tick(sub, c, { seed: 1 } as RNGState, { scrollDelta });
  swap(sub);
}

describe("abismo engine — depth causality", () => {
  it("starts fully zoomed out (depth 0)", () => {
    const sub = allocSubstrate(cfg());
    expect(sub.read.depth).toBe(0);
    expect(sub.read.tick).toBe(0);
  });

  it("integrates scrollDelta into depth each tick", () => {
    const c = cfg();
    const sub = allocSubstrate(c);
    step(sub, c, 1.5);
    expect(sub.read.depth).toBeCloseTo(1.5, 12);
    expect(sub.read.tick).toBe(1);
    step(sub, c, 0.5);
    expect(sub.read.depth).toBeCloseTo(2.0, 12);
  });

  it("is exactly reversible — a −delta undoes a +delta", () => {
    const c = cfg();
    const sub = allocSubstrate(c);
    step(sub, c, 2.3);
    step(sub, c, -2.3);
    expect(sub.read.depth).toBe(0);
  });

  it("clamps depth to [0, depth_max]", () => {
    const c = cfg({ depth_max: 5 });
    const sub = allocSubstrate(c);
    step(sub, c, 99); // dive past the wall
    expect(sub.read.depth).toBe(5);
    step(sub, c, -99); // rise past the surface
    expect(sub.read.depth).toBe(0);
  });

  it("is deterministic — two identical input streams match", () => {
    const run = () => {
      const c = cfg();
      const sub = allocSubstrate(c);
      const deltas = [0.02, 0.02, -0.01, 0.5, 0.02];
      for (const d of deltas) step(sub, c, d);
      return sub.read.depth;
    };
    expect(run()).toBe(run());
  });
});

describe("abismo parseLevel", () => {
  it("defaults a sparse level to the misiu-spiral center", () => {
    const c = parseLevel({ id: "x" });
    expect(c.center_re).toBeCloseTo(-0.10109636384562, 12);
    expect(c.center_im).toBeCloseTo(0.95628651080914, 12);
    expect(c.depth_max).toBe(12.6);
    expect(c.palette).toBe("ink");
  });
});
