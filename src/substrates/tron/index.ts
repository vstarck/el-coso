/* Tron — substrate package barrel.
 *
 * The first AUTOPLAY substrate with recorded per-tick input, built as the
 * worked example behind the Agency design question (Q4 *continuous /
 * held*) and the `attachKeyControls` kit. A light-cycle lays a fatal
 * trail; steer a held heading and survive to the target tick.
 */

import { tronBundle, tronBttfAdapter, parseLevel } from "./engine";
import { tronLens } from "./lens";
import openArena from "./puzzles/open-arena.json";
import tightArena from "./puzzles/tight-arena.json";
import swarm from "./puzzles/swarm.json";

export const bundle = tronBundle;
export const adapter = tronBttfAdapter;
export const lenses = { "tron-arena": tronLens } as const;
export const defaultLensId = "tron-arena";
export { parseLevel };
export const puzzles: unknown[] = [openArena, tightArena, swarm];
export const meta = {
  id: "tron",
  name: "Tron",
  defaultPuzzle: "open-arena",
  keyframePeriod: 60,
} as const;

export * from "./engine";
