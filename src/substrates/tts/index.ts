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
// Gallery thumbnail — Vite resolves the import to a hashed asset URL at build
// time. To give another substrate a real card image, drop a square image in
// its package's `assets/` and import it the same way into `meta.thumbnail`.
import thumbnail from "./assets/thumbnail.webp";

export const bundle = ttsBundle;
export const adapter = ttsBttfAdapter;
export const lenses = { "tts-json": ttsLens } as const;
export const defaultLensId = "tts-json";
export { parseLevel };
export const puzzles: unknown[] = [classic, small];
export const meta = {
  id: "tts",
  name: "tts",
  description:
    "The simplest possible Tetris, dressed as a fish-shell terminal session.",
  thumbnail,
  defaultPuzzle: "classic",
  keyframePeriod: 100,
} as const;

export * from "./engine";
