/* Julia — substrate package barrel.
 *
 * An escape-time fractal showcase: the Julia set of z → z² + c, with c drifting
 * along an orbit so the set morphs. Mandelbrot mode is the same renderer with
 * the pixel driving c — the atlas of all Julia sets. The lens is the
 * non-trivial forward operator (escape-time → pixels); `max_iter` is its slice
 * thickness. Adopts the guake console for text steering.
 */

import { juliaBundle, juliaBttfAdapter, parseLevel } from "./engine";
import { juliaLens, juliaGlLens } from "./lens";
import tour from "./puzzles/tour.json";
import rabbit from "./puzzles/rabbit.json";
import mandelbrot from "./puzzles/mandelbrot.json";

export const bundle = juliaBundle;
export const adapter = juliaBttfAdapter;
// Two lenses, identical except CPU (Canvas 2D) vs GPU (WebGL) rendering — flip
// in the toolbar lens picker to compare framerate.
export const lenses = {
  "julia-grid": juliaLens,
  "julia-gl": juliaGlLens,
} as const;
export const defaultLensId = "julia-grid";
export { parseLevel };
export const puzzles: unknown[] = [tour, rabbit, mandelbrot];
export const meta = {
  id: "julia",
  name: "Julia",
  description:
    "Escape-time fractals — the Julia set of z → z² + c, morphing as c drifts; Mandelbrot is its atlas.",
  tags: ["fractal", "math"],
  defaultPuzzle: "tour",
  keyframePeriod: 100,
} as const;

export * from "./engine";
