import type { AbismoConfig } from "./config";

// Authoring-flat JSON in, runtime config out. Every field is optional with a
// defensive fallback so a sparse puzzle file still parses to a valid config.
export type LevelFile = {
  id: string;
  center_re?: number;
  center_im?: number;
  depth_max?: number;
  dive_speed?: number;
  iter_base?: number;
  iter_per_depth?: number;
  period?: number;
  palette?: string;
  color_density?: number;
};

// The locked dive center — the `misiu-spiral` Misiurewicz point, self-similar
// detail at every scale, 0% interior to the float64 wall (see the fractal-dive
// probe). The fallback when a puzzle names no center.
const DEFAULT_CENTER = { re: -0.10109636384562, im: 0.95628651080914 };

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function parseLevel(json: unknown): AbismoConfig {
  const o = json as LevelFile;
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    center_re: num(o.center_re, DEFAULT_CENTER.re),
    center_im: num(o.center_im, DEFAULT_CENTER.im),
    depth_max: num(o.depth_max, 12.6),
    dive_speed: num(o.dive_speed, 0.02),
    iter_base: num(o.iter_base, 200),
    iter_per_depth: num(o.iter_per_depth, 120),
    period: num(o.period, 32),
    palette: typeof o.palette === "string" ? o.palette : "ink",
    color_density: num(o.color_density, 0.35),
  };
}
