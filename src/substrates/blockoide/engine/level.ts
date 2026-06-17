import type { BlockoideConfig } from "./config";

// Authoring-flat JSON in, runtime config out. Defaults are a snappy 4×4×10
// well, 0.8 s/step gravity at 60 Hz, 8-layer win.
//
// Obstacles are authored two ways, both compiled to flat `walls` indices:
//   - `columns`: [x, y] pairs → a full-height permanent column (the common
//     "pillar" case; a non-rectangular cross-section).
//   - `well`: per-depth ASCII slices. `well[z]` is an array of D rows, each
//     a W-char string; '#' marks a wall cell, any other char is empty. For
//     scattered fixed cells the per-z view is read in the same human-
//     readable register as every other substrate's ASCII map.
export type LevelFile = {
  id: string;
  description?: string;
  W?: number;
  D?: number;
  H?: number;
  gravity_period?: number;
  soft_factor?: number;
  move_period?: number;
  win_layers?: number;
  columns?: Array<[number, number]>;
  well?: string[][];
};

export function parseLevel(json: unknown): BlockoideConfig {
  const o = json as LevelFile;
  const W = typeof o.W === "number" ? o.W : 4;
  const D = typeof o.D === "number" ? o.D : 4;
  const H = typeof o.H === "number" ? o.H : 10;

  const wallSet = new Set<number>();
  const push = (x: number, y: number, z: number): void => {
    if (x < 0 || x >= W || y < 0 || y >= D || z < 0 || z >= H) return;
    wallSet.add(z * (W * D) + y * W + x);
  };

  if (Array.isArray(o.columns)) {
    for (const col of o.columns) {
      const [x, y] = col;
      for (let z = 0; z < H; z++) push(x, y, z);
    }
  }
  if (Array.isArray(o.well)) {
    o.well.forEach((slice, z) => {
      slice.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === "#") push(x, y, z);
        }
      });
    });
  }

  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    W,
    D,
    H,
    gravity_period: typeof o.gravity_period === "number" ? o.gravity_period : 48,
    soft_factor: typeof o.soft_factor === "number" ? o.soft_factor : 10,
    move_period: typeof o.move_period === "number" ? o.move_period : 5,
    win_layers: typeof o.win_layers === "number" ? o.win_layers : 8,
    walls: [...wallSet],
  };
}
