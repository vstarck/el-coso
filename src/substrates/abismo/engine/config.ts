// abismo substrate config — a fixed-center infinite dive into the Mandelbrot
// set. The world is a single scalar `depth` (log10 zoom); everything visible is
// a pure function of it. Config carries the dive CENTER (must be a Misiurewicz
// point for detail at every scale — see context/substrates/fractal-dive), the
// depth ceiling (the float64 precision wall), the auto-dive rate, and the
// coloring/iteration defaults the lens seeds its tunables from.

export type AbismoConfig = {
  id: string;
  // The dive center in the complex plane. A Misiurewicz point keeps self-similar
  // detail (0% interior) all the way to the float64 wall.
  center_re: number;
  center_im: number;
  // log10(zoom) ceiling. Past ~12.6 the per-pixel scale hits the double mantissa
  // floor and the image blocks up — the hard wall for plain float64.
  depth_max: number;
  // Auto-dive rate: depth units advanced per tick when self-diving (the lens
  // hands control to real scroll input on the first wheel event).
  dive_speed: number;
  // max_iter = iter_base + iter_per_depth · depth (deeper boundaries need more).
  iter_base: number;
  iter_per_depth: number;
  // Cyclic cosine coloring defaults (the lens exposes both as tunables).
  period: number; // iteration counts per full colour cycle
  palette: string; // a CYCLIC_PALETTES name
  color_density: number;
};
