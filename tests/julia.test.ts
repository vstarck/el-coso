import { describe, expect, it } from "vitest";
import {
  allocSubstrate,
  cAtPhase,
  parseLevel,
  swap,
  tick,
  type JuliaConfig,
} from "../src/substrates/julia";
import type { RNGState } from "../src/engine/types";
import {
  escapeCount,
  paletteColor,
  renderFractal,
  type RenderParams,
} from "../src/lib/fractal";

const cfg = (over: Record<string, unknown> = {}): JuliaConfig =>
  parseLevel({
    id: "test",
    mode: "julia",
    orbit: { center_re: 0, center_im: 0, radius: 0.8, speed: 0.01 },
    res: 64,
    ...over,
  });

describe("julia engine — orbit causality", () => {
  it("seeds c at the orbit's phase-0 point", () => {
    const sub = allocSubstrate(cfg());
    // center (0,0) + radius 0.8 at phase 0 ⇒ (0.8, 0)
    expect(sub.read.c_re).toBeCloseTo(0.8, 12);
    expect(sub.read.c_im).toBeCloseTo(0, 12);
    expect(sub.read.tick).toBe(0);
  });

  it("advances phase and follows the orbit each tick", () => {
    const c = cfg();
    const sub = allocSubstrate(c);
    let rng: RNGState = { seed: 1 };
    rng = tick(sub, c, rng, {});
    swap(sub);
    expect(sub.read.tick).toBe(1);
    const want = cAtPhase(c.orbit, 0.01);
    expect(sub.read.c_re).toBeCloseTo(want.re, 12);
    expect(sub.read.c_im).toBeCloseTo(want.im, 12);
  });

  it("is deterministic — two runs land on the same c", () => {
    const run = () => {
      const c = cfg();
      const sub = allocSubstrate(c);
      let rng: RNGState = { seed: 42 };
      for (let i = 0; i < 25; i++) {
        rng = tick(sub, c, rng, {});
        swap(sub);
      }
      return [sub.read.c_re, sub.read.c_im];
    };
    expect(run()).toEqual(run());
  });

  it("a speed-0 orbit parks c forever (a still set)", () => {
    const c = cfg({ orbit: { center_re: -0.123, center_im: 0.745, radius: 0, speed: 0 } });
    const sub = allocSubstrate(c);
    let rng: RNGState = { seed: 1 };
    for (let i = 0; i < 10; i++) {
      rng = tick(sub, c, rng, {});
      swap(sub);
    }
    expect(sub.read.c_re).toBeCloseTo(-0.123, 12);
    expect(sub.read.c_im).toBeCloseTo(0.745, 12);
  });
});

describe("julia render — escape-time", () => {
  it("z₀=0, c=0 never escapes (interior ⇒ max)", () => {
    expect(escapeCount(0, 0, 0, 0, 100, false)).toBe(100);
  });

  it("a point outside the disc escapes fast", () => {
    expect(escapeCount(2, 0, 0, 0, 100, false)).toBeLessThan(5);
  });

  it("Mandelbrot: c=0 interior, c=2 escapes", () => {
    // Mandelbrot iterates z from 0 with c = the point.
    expect(escapeCount(0, 0, 0, 0, 100, false)).toBe(100);
    expect(escapeCount(0, 0, 2, 0, 100, false)).toBeLessThan(5);
  });

  it("escape count is independent of max_iter (the occlusion fix)", () => {
    // A point that escapes does so at the same iteration regardless of the
    // budget — so its color must not change when max_iter rises.
    const at120 = escapeCount(0.6, 0.4, -0.4, 0.6, 120, true);
    const at800 = escapeCount(0.6, 0.4, -0.4, 0.6, 800, true);
    expect(at120).toBeLessThan(120); // it does escape
    expect(at800).toBeCloseTo(at120, 10);
  });

  it("palette ramps from dark to light", () => {
    const lo = paletteColor("structure", 0);
    const hi = paletteColor("structure", 1);
    expect(hi[0]).toBeGreaterThan(lo[0]);
  });

  it("fills the whole RGBA buffer with opaque pixels", () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    const params: RenderParams = {
      mode: "julia",
      c_re: -0.4,
      c_im: 0.6,
      center_re: 0,
      center_im: 0,
      zoom: 1,
      max_iter: 60,
      palette: "fire",
      smooth: true,
      color_density: 0.25,
    };
    renderFractal(data, w, h, params);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });
});
