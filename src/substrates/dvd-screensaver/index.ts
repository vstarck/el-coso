/* dvd-screensaver — substrate package barrel.
 *
 * A single Verlet particle bouncing in a continuous box (autonomous, no
 * input). Its reason to exist is the COMPOSITE lens: a base "space" root with
 * four enrichment overlays (velocity / acceleration / jitter / projection) and
 * an in-canvas HUD that toggles them. The second composing-lens instance in
 * the project and the first to use `LensMountArgs.children` for cross-layer
 * coordination. */

import { dvdBundle, dvdBttfAdapter, parseLevel } from "./engine";
import { dvdLens } from "./lens";
import classicDvd from "./puzzles/classic-dvd.json";
import gravityWell from "./puzzles/gravity-well.json";

export const bundle = dvdBundle;
export const adapter = dvdBttfAdapter;
export const lenses = { "dvd-screensaver": dvdLens } as const;
export const defaultLensId = "dvd-screensaver";
export { parseLevel };
export const puzzles: unknown[] = [classicDvd, gravityWell];
export const meta = {
  id: "dvd-screensaver",
  name: "DVD",
  defaultPuzzle: "classic-dvd",
  keyframePeriod: 100,
} as const;

export * from "./engine";
