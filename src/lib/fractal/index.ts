/* Escape-time fractal renderer — a pure, host-agnostic forward operator. Given
 * the parameters it fills an RGBA buffer (no DOM, no canvas), so it backs both a
 * Canvas-2D `putImageData` painter and a headless test/probe equally. This is
 * where the engine's "max_iter is slice thickness" idea lives — a shallow
 * iteration budget cannot resolve the boundary filaments a deep one reveals.
 *
 * Julia mode: the pixel is z₀, c is the (orbiting) parameter.
 * Mandelbrot mode: the pixel is c, z₀ = 0 — the same map, atlas of all Julias.
 *
 * Extracted from the julia substrate (S117) once a second consumer arrived: the
 * fractal-dive showcase reuses the exact escape-time math, and substrates must
 * not import each other, so the shared operator lives here in `lib/`.
 *
 * Precision note (deep zoom): the plane coordinate is `center + pixel·scale` in
 * float64. Around zoom ≈ 1e13 the per-pixel `scale` (~1e-15) reaches the mantissa
 * floor and adjacent pixels collapse to the same double — the image blocks up.
 * That's the hard wall for plain doubles; true "infinite" zoom needs perturbation
 * theory + an arbitrary-precision reference orbit (not done here).
 */

// Which variable the pixel drives: z₀ (julia) or c (mandelbrot).
export type FractalMode = "julia" | "mandelbrot";

export type PaletteName = "fire" | "ice" | "structure";
export const PALETTE_NAMES: PaletteName[] = ["fire", "ice", "structure"];

export type RenderParams = {
  mode: FractalMode;
  c_re: number;
  c_im: number;
  center_re: number;
  center_im: number;
  zoom: number; // 1 ⇒ the view spans BASE_SPAN complex units across its short edge
  max_iter: number;
  palette: PaletteName;
  smooth: boolean;
  // Coloring contrast, independent of max_iter. The escape count of a point
  // that escapes does NOT depend on the iteration budget, so color must map
  // off the raw count — not `count / max_iter` (which darkens everything as
  // max_iter rises). Higher density ⇒ the palette ramps up faster.
  color_density: number;
  // Optional cyclic cosine coloring (for the infinite dive). When set it REPLACES
  // the `palette`/`smooth`/`color_density` path with a seamless periodic colour
  // that never washes out at depth. Absent ⇒ the saturating palette (julia).
  cyclic?: CyclicColoring;
};

// Complex-plane width mapped across the short edge of the buffer at zoom 1.
export const BASE_SPAN = 3.2;

type RGB = readonly [number, number, number];
type Stop = readonly [number, RGB];

// Palette ramps — escape "depth" 0→1 mapped to color. Interior (never escaped)
// is painted near-black by the first stop's neighborhood; escaped points walk
// the ramp.
const PALETTES: Record<PaletteName, Stop[]> = {
  fire: [
    [0.0, [0, 0, 0]],
    [0.25, [90, 12, 8]],
    [0.5, [210, 70, 12]],
    [0.75, [248, 186, 48]],
    [1.0, [255, 255, 224]],
  ],
  ice: [
    [0.0, [0, 0, 0]],
    [0.3, [12, 32, 92]],
    [0.6, [34, 116, 204]],
    [0.85, [126, 214, 242]],
    [1.0, [244, 255, 255]],
  ],
  structure: [
    [0.0, [8, 8, 12]],
    [0.5, [122, 124, 134]],
    [1.0, [246, 246, 250]],
  ],
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Sample a palette at t∈[0,1].
export function paletteColor(name: PaletteName, t: number): RGB {
  const stops = PALETTES[name];
  const tt = t <= 0 ? 0 : t >= 1 ? 1 : t;
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!;
    if (tt <= p1) {
      const [p0, c0] = stops[i - 1]!;
      const span = p1 - p0 || 1;
      const k = (tt - p0) / span;
      return [
        Math.round(lerp(c0[0], c1[0], k)),
        Math.round(lerp(c0[1], c1[1], k)),
        Math.round(lerp(c0[2], c1[2], k)),
      ];
    }
  }
  return stops[stops.length - 1]![1];
}

// ── Cyclic cosine coloring ───────────────────────────────────────────────────
// For an infinite dive the escape count grows without bound, so a saturating
// palette (paletteColor above) washes deep frames to one shade. A periodic
// cosine palette instead loops forever, staying vivid at any depth, and being
// C∞ it's seamless (no band edges) ⇒ "suave". Inigo-Quilez form, per channel:
//   color(t) = a + b · cos(2π · (c · t + d))
// `t = smoothCount / period`; bigger period ⇒ broader, smoother colour washes.
export type CyclicPalette = {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  c: readonly [number, number, number];
  d: readonly [number, number, number];
};

export type CyclicColoring = {
  period: number; // iteration counts per full colour cycle
  palette: CyclicPalette;
  bailout2?: number; // squared escape radius (default 65536 = radius 256)
};

// A few tasteful presets. Rainbow is the busy classic; the others are lower-
// frequency / duotone for a calmer, more "suave" wash.
export const CYCLIC_PALETTES: Record<string, CyclicPalette> = {
  aurora: { a: [0.5, 0.5, 0.5], b: [0.45, 0.45, 0.5], c: [1, 1, 1], d: [0.55, 0.4, 0.25] },
  ember: { a: [0.5, 0.4, 0.32], b: [0.5, 0.4, 0.32], c: [1, 1, 1], d: [0.0, 0.08, 0.16] },
  ink: { a: [0.55, 0.58, 0.62], b: [0.42, 0.42, 0.45], c: [1, 1, 1], d: [0.0, 0.03, 0.08] },
  rainbow: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.0, 0.33, 0.67] },
};
export const CYCLIC_PALETTE_NAMES = Object.keys(CYCLIC_PALETTES);

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Sample a cosine palette at phase t (any real; the cos wraps it).
export function cosineColor(t: number, p: CyclicPalette): RGB {
  const TAU = 6.283185307179586;
  const ch = (i: 0 | 1 | 2): number =>
    Math.round(255 * clamp01(p.a[i] + p.b[i] * Math.cos(TAU * (p.c[i] * t + p.d[i]))));
  return [ch(0), ch(1), ch(2)];
}

// Escape-time count for one point. Returns a fractional ("smooth") count when
// `smooth`, else the integer iteration count; `max` ⇒ the point is interior.
// `bailout2` is the squared escape radius — the default 4 (radius 2) is the
// classic bailout; a larger radius (e.g. 65536, radius 256) makes the SMOOTH
// estimate much smoother (suaver gradients), at the cost of a few extra iters.
export function escapeCount(
  zr0: number,
  zi0: number,
  cr: number,
  ci: number,
  max: number,
  smooth: boolean,
  bailout2: number = 4,
): number {
  let zr = zr0;
  let zi = zi0;
  let zr2 = zr * zr;
  let zi2 = zi * zi;
  let n = 0;
  while (n < max && zr2 + zi2 <= bailout2) {
    zi = 2 * zr * zi + ci;
    zr = zr2 - zi2 + cr;
    zr2 = zr * zr;
    zi2 = zi * zi;
    n++;
  }
  if (n >= max) return max;
  if (!smooth) return n;
  // Normalized iteration count: n + 1 − log₂(log₂|z|). Smooths the bands.
  const logZn = Math.log(zr2 + zi2) / 2; // ln|z|
  const nu = Math.log(logZn / Math.LN2) / Math.LN2; // log₂(log₂|z|)
  const mu = n + 1 - nu;
  return mu < 0 ? 0 : mu > max ? max : mu;
}

// Fill an RGBA buffer (length w*h*4) with the escape-time image.
export function renderFractal(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  p: RenderParams,
): void {
  const short = Math.min(w, h);
  const scale = BASE_SPAN / p.zoom / short; // complex units per pixel (square)
  const ox = p.center_re - (w / 2) * scale;
  const oy = p.center_im - (h / 2) * scale;
  const max = p.max_iter;
  const julia = p.mode === "julia";
  const cyc = p.cyclic;
  const bailout2 = cyc ? cyc.bailout2 ?? 65536 : 4;
  const smooth = cyc ? true : p.smooth;
  let idx = 0;
  for (let py = 0; py < h; py++) {
    const planeY = oy + py * scale;
    for (let px = 0; px < w; px++) {
      const planeX = ox + px * scale;
      const zr0 = julia ? planeX : 0;
      const zi0 = julia ? planeY : 0;
      const cr = julia ? p.c_re : planeX;
      const ci = julia ? p.c_im : planeY;
      const n = escapeCount(zr0, zi0, cr, ci, max, smooth, bailout2);
      if (n >= max) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
      } else if (cyc) {
        // Seamless periodic colour off the smooth count — vivid at any depth.
        const col = cosineColor(n / cyc.period, cyc.palette);
        data[idx] = col[0];
        data[idx + 1] = col[1];
        data[idx + 2] = col[2];
      } else {
        // Soft saturation off the RAW escape count (sqrt spreads the low end).
        // max_iter-independent: raising the budget reveals more boundary detail
        // instead of darkening the whole image.
        const t = 1 - Math.exp(-Math.sqrt(n) * p.color_density);
        const col = paletteColor(p.palette, t);
        data[idx] = col[0];
        data[idx + 1] = col[1];
        data[idx + 2] = col[2];
      }
      data[idx + 3] = 255;
      idx += 4;
    }
  }
}

// Map a complex point to buffer-pixel coordinates (for overlays like the
// Mandelbrot tour marker). Inverse of the mapping in renderFractal.
export function planeToPixel(
  re: number,
  im: number,
  w: number,
  h: number,
  centerRe: number,
  centerIm: number,
  zoom: number,
): { x: number; y: number } {
  const short = Math.min(w, h);
  const scale = BASE_SPAN / zoom / short;
  return {
    x: (re - centerRe) / scale + w / 2,
    y: (im - centerIm) / scale + h / 2,
  };
}
