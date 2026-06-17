/* Conway — substrate package barrel. */

import { conwayBundle, conwayBttfAdapter, parseLevel } from "./engine";
import { conwayLens } from "./lens";
import rPentominoLarge from "./puzzles/r-pentomino-large.json";
import rPentomino from "./puzzles/r-pentomino.json";
import glider from "./puzzles/glider.json";
import blinker from "./puzzles/blinker.json";
import randomDensity from "./puzzles/random-density.json";

export const bundle = conwayBundle;
export const adapter = conwayBttfAdapter;
export const lenses = { "conway-grid": conwayLens } as const;
export const defaultLensId = "conway-grid";
export { parseLevel };
export const puzzles: unknown[] = [
  rPentominoLarge,
  rPentomino,
  glider,
  blinker,
  randomDensity,
];
export const meta = {
  id: "conway",
  name: "Conway",
  defaultPuzzle: "r-pentomino-large",
  keyframePeriod: 100,
} as const;

export * from "./engine";
