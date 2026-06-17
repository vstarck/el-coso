import type { ConwayConfig, SeedPattern } from "./config";

// Authoring-side JSON shape. One file per puzzle in `src/web/puzzles-conway/`.
// Flat for readability; parseLevel composes the discriminated SeedPattern.
export type LevelFile = {
  id: string;
  description?: string;
  rng_seed: number;
  W?: number;
  H?: number;
  boundary_x?: "wall" | "wrap";
  boundary_y?: "wall" | "wrap";

  // Discriminated by seed_kind. Only the field for the chosen kind needs to
  // be set; others are ignored.
  seed_kind: "pattern" | "ascii" | "random_density";
  pattern?: number[];      // flat (x, y) pairs; used iff seed_kind = "pattern"
  grid?: string[];         // ASCII rows; used iff seed_kind = "ascii"
  density?: number;        // [0, 1]; used iff seed_kind = "random_density"
};

export function parseLevel(level: LevelFile): ConwayConfig {
  const seed: SeedPattern = parseSeed(level);
  const { W, H } = dimensions(level, seed);
  if (W <= 0 || H <= 0) {
    throw new Error(`invalid Conway level "${level.id}": dimensions ${W}x${H}`);
  }
  const config: ConwayConfig = {
    id: level.id,
    rng_seed: level.rng_seed,
    W,
    H,
    boundary_x: level.boundary_x ?? "wrap",
    boundary_y: level.boundary_y ?? "wrap",
    seed,
  };
  if (level.description !== undefined) config.description = level.description;
  return config;
}

function parseSeed(level: LevelFile): SeedPattern {
  if (level.seed_kind === "pattern") {
    if (!Array.isArray(level.pattern)) {
      throw new Error(`Conway level "${level.id}": pattern[] required for seed_kind=pattern`);
    }
    return { kind: "pattern", cells: level.pattern.slice() };
  }
  if (level.seed_kind === "ascii") {
    if (!Array.isArray(level.grid)) {
      throw new Error(`Conway level "${level.id}": grid[] required for seed_kind=ascii`);
    }
    const rows = level.grid;
    if (rows.length === 0) {
      throw new Error(`Conway level "${level.id}": grid[] is empty`);
    }
    const w = rows[0]!.length;
    for (const r of rows) {
      if (r.length !== w) {
        throw new Error(`Conway level "${level.id}": grid rows must all have equal length`);
      }
      for (const ch of r) {
        if (ch !== "." && ch !== "O") {
          throw new Error(`Conway level "${level.id}": only '.' and 'O' allowed in grid (got "${ch}")`);
        }
      }
    }
    return { kind: "ascii", rows };
  }
  if (level.seed_kind === "random_density") {
    if (typeof level.density !== "number") {
      throw new Error(`Conway level "${level.id}": density required for seed_kind=random_density`);
    }
    return { kind: "random_density", density: level.density };
  }
  throw new Error(`Conway level "${level.id}": unknown seed_kind "${String((level as { seed_kind?: unknown }).seed_kind)}"`);
}

function dimensions(level: LevelFile, seed: SeedPattern): { W: number; H: number } {
  if (seed.kind === "ascii") {
    const W = seed.rows[0]!.length;
    const H = seed.rows.length;
    return { W, H };
  }
  if (typeof level.W !== "number" || typeof level.H !== "number") {
    throw new Error(`Conway level "${level.id}": W and H required for seed_kind=${seed.kind}`);
  }
  return { W: level.W, H: level.H };
}
