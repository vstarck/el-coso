/* tts — substrate package barrel.
 *
 * The simplest possible Tetris: a 10x20 well, the seven classic tetrominoes,
 * gravity, line clears, lose-on-top-out. Its single lens is a plain-JSON
 * terminal readout of the substrate state — the board reaches the view as a
 * character grid (one letter per piece), rendered in one themable color.
 */

import { ttsBundle, ttsBttfAdapter, parseLevel } from "./engine";
import { ttsLens } from "./lens";
import classic from "./puzzles/classic.json";
import small from "./puzzles/small.json";

export const bundle = ttsBundle;
export const adapter = ttsBttfAdapter;
export const lenses = { "tts-json": ttsLens } as const;
export const defaultLensId = "tts-json";
export { parseLevel };
export const puzzles: unknown[] = [classic, small];
export const meta = {
  id: "tts",
  name: "tts",
  defaultPuzzle: "classic",
  keyframePeriod: 100,
} as const;

export * from "./engine";
