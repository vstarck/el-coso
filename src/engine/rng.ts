import type { RNGState } from "./types";

// Mulberry32. 32-bit state, deterministic across browsers.
export function nextUniform(rng: RNGState): { value: number; rng: RNGState } {
  const s = (rng.seed + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { seed: s } };
}

// Shape helpers: the pure uniform→value maps behind nextNormal/nextRange,
// factored out so the resolver seam (spec/27) can apply the exact same
// shaping to uniforms from a non-mulberry source (injected entropy) without
// duplicating the formulas. This file stays the single owner of both the
// bit-stream and the shaping expressions.

// Standard normal via Box–Muller from two uniforms.
export function shapeNormal(u1raw: number, u2: number): number {
  // Avoid log(0): clamp u1 away from zero.
  const u1 = u1raw < 1e-12 ? 1e-12 : u1raw;
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  return r * Math.cos(theta);
}

// Uniform in [lo, hi) from one uniform.
export function shapeRange(u: number, lo: number, hi: number): number {
  return lo + u * (hi - lo);
}

// Standard normal via Box–Muller. Consumes two uniforms.
export function nextNormal(rng: RNGState): { value: number; rng: RNGState } {
  const a = nextUniform(rng);
  const b = nextUniform(a.rng);
  return { value: shapeNormal(a.value, b.value), rng: b.rng };
}

// Uniform in [lo, hi). Consumes one uniform.
export function nextRange(rng: RNGState, lo: number, hi: number): { value: number; rng: RNGState } {
  const u = nextUniform(rng);
  return { value: shapeRange(u.value, lo, hi), rng: u.rng };
}
