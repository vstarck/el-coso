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

// Standard normal via Box–Muller. Consumes two uniforms.
export function nextNormal(rng: RNGState): { value: number; rng: RNGState } {
  const a = nextUniform(rng);
  const b = nextUniform(a.rng);
  // Avoid log(0): clamp u1 away from zero.
  const u1 = a.value < 1e-12 ? 1e-12 : a.value;
  const r = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * b.value;
  return { value: r * Math.cos(theta), rng: b.rng };
}

// Uniform in [lo, hi). Consumes one uniform.
export function nextRange(rng: RNGState, lo: number, hi: number): { value: number; rng: RNGState } {
  const u = nextUniform(rng);
  return { value: lo + u.value * (hi - lo), rng: u.rng };
}
