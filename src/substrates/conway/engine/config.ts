// Conway puzzle configuration. Authored once per level, immutable per
// puzzle instance.
//
// Discriminated union for the seed: a fixed pattern, an ASCII grid, or a
// random-density init that consumes the puzzle's `rng_seed`. Maps to a
// GDScript enum + struct cleanly per the translatability constraint.

export type SeedPattern =
  | { kind: "pattern"; cells: number[] }          // flat (x, y) pairs to set alive
  | { kind: "ascii"; rows: string[] }             // '.' = dead, 'O' = alive
  | { kind: "random_density"; density: number };  // [0, 1]; rolled per cell at init

export type ConwayConfig = {
  id: string;
  description?: string;
  rng_seed: number;
  W: number;
  H: number;
  boundary_x: "wall" | "wrap";
  boundary_y: "wall" | "wrap";
  seed: SeedPattern;
};
