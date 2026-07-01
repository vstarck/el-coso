import type { FractalMode, JuliaConfig, Orbit } from "./config";

// Authoring-flat JSON in, runtime config out. Every field is optional with a
// defensive fallback so a sparse puzzle file still parses to a valid config.
export type LevelFile = {
  id: string;
  mode?: FractalMode;
  orbit?: Partial<Orbit>;
  res?: number;
};

// A parked Julia parameter in the seahorse valley — the fallback when a puzzle
// declares no orbit.
const DEFAULT_ORBIT: Orbit = {
  center_re: -0.75,
  center_im: 0.11,
  radius: 0,
  speed: 0,
};

export function parseLevel(json: unknown): JuliaConfig {
  const o = json as LevelFile;
  const orbit = o.orbit ?? {};
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    mode: o.mode === "mandelbrot" ? "mandelbrot" : "julia",
    orbit: {
      center_re: typeof orbit.center_re === "number" ? orbit.center_re : DEFAULT_ORBIT.center_re,
      center_im: typeof orbit.center_im === "number" ? orbit.center_im : DEFAULT_ORBIT.center_im,
      radius: typeof orbit.radius === "number" ? orbit.radius : DEFAULT_ORBIT.radius,
      speed: typeof orbit.speed === "number" ? orbit.speed : DEFAULT_ORBIT.speed,
    },
    res: typeof o.res === "number" ? o.res : 256,
  };
}
