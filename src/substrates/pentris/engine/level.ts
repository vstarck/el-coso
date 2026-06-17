import type { PentrisConfig } from "./config";

// Authoring-flat JSON in, runtime config out. Defaults are the marathon
// shape: 12×22 well, 0.8 s/row gravity at 60 Hz, 20-line win.
export type LevelFile = {
  id: string;
  W?: number;
  H?: number;
  gravity_period?: number;
  soft_factor?: number;
  move_period?: number;
  win_lines?: number;
};

export function parseLevel(json: unknown): PentrisConfig {
  const o = json as LevelFile;
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    W: typeof o.W === "number" ? o.W : 12,
    H: typeof o.H === "number" ? o.H : 22,
    gravity_period: typeof o.gravity_period === "number" ? o.gravity_period : 48,
    soft_factor: typeof o.soft_factor === "number" ? o.soft_factor : 10,
    move_period: typeof o.move_period === "number" ? o.move_period : 5,
    win_lines: typeof o.win_lines === "number" ? o.win_lines : 20,
  };
}
