/* abismo — substrate package barrel.
 *
 * An infinite, scroll-driven dive into a fixed Misiurewicz point of the
 * Mandelbrot set: a showcase infographic, not a game (no Bias, no win). State is
 * one scalar `depth` (log10 zoom), so the evolution axis is ZOOM sampled on
 * scroll-delta — a cadence, and an exactly reversible one (zoom-out is bit-
 * identical backward time). The lens is the forward operator (escape-time →
 * cyclic-cosine colour), CPU float64 for depth the GPU can't reach. Adopts the
 * guake console.
 */

import { abismoBundle, abismoBttfAdapter, parseLevel } from "./engine";
import { abismoLens } from "./lens";
import descent from "./puzzles/descent.json";

export const bundle = abismoBundle;
export const adapter = abismoBttfAdapter;
export const lenses = {
  "abismo-dive": abismoLens,
} as const;
export const defaultLensId = "abismo-dive";
export { parseLevel };
export const puzzles: unknown[] = [descent];
export const meta = {
  id: "abismo",
  name: "abismo",
  description:
    "An infinite scroll-driven dive into the Mandelbrot set — static over time, alive over zoom.",
  tags: ["fractal", "math", "showcase"],
  defaultPuzzle: "descent",
  keyframePeriod: 100,
  // the gallery card (S251): FILES in ./preview/, filmed by la-cosa dev/capture-preview and served at /previews/<id>/
  // (vite-plugins servePreviews) — URLs, never imports: an import lands in a bundle
  thumbnail: "/previews/abismo/still.webp",
  preview: "/previews/abismo/clip.webm",
} as const;

export * from "./engine";
