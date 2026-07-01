/* Deep-zoom-into-a-point probe (S117) — "measure before pixels" for the
 * fractal-dive showcase. Renders several candidate Mandelbrot center points
 * across a geometric zoom sweep and reports two metrics per frame:
 *
 *   interior%  — pixels that never escape (n ≥ max_iter). A frame that's all
 *                interior (sank into the black body) or all exterior is dull.
 *   richness%  — fraction of horizontally-adjacent pixel pairs whose integer
 *                escape count differs. High ⇒ the frame is full of boundary
 *                filaments (interesting). It craters two ways: a flat frame
 *                (no detail), AND float64 pixel-collapse at deep zoom (adjacent
 *                plane coords round to the same double ⇒ identical counts over
 *                blocks). So richness doubles as a precision-wall detector.
 *
 * Run: npx vitest run tests/fractal-dive-probe.test.ts  (reads the logged table)
 * The kept assertion guards that the chosen center stays non-degenerate through
 * the depth range the scroll piece will actually use.
 */

import { describe, expect, it } from "vitest";
import { escapeCount } from "../src/lib/fractal";
import { BASE_SPAN } from "../src/lib/fractal";

type Center = { name: string; re: number; im: number };

// High-precision (full float64) famous deep-zoom coordinates. Misiurewicz /
// pre-periodic points keep self-similar detail at EVERY scale; an approximate
// boundary coord instead sinks into the black body or thins to sparse dust.
const CENTERS: Center[] = [
  { name: "seahorse-full", re: -0.7436438870371587, im: 0.13182590420531197 },
  { name: "misiu-spiral", re: -0.10109636384562, im: 0.95628651080914 },
  { name: "dendrite", re: -0.235124999, im: 0.827215 },
  { name: "spiral-2", re: 0.001643721971153, im: -0.822467633298876 },
  { name: "deep-real", re: -1.7693831791955150, im: 0.0042368479187367 },
  { name: "seahorse-2", re: -0.7453, im: 0.1127 },
];

const RES = 200; // metric-only buffer side
const ZOOM_EXPONENTS = [0, 2, 4, 6, 8, 10, 12, 14]; // 1 … 1e14

// max_iter grows with depth — deeper boundaries need a bigger budget to resolve.
function maxIterFor(zoom: number): number {
  return Math.round(120 + 90 * Math.log10(Math.max(1, zoom)));
}

// Render integer escape counts into a flat array (no color), then derive the two
// metrics. Mandelbrot mode: the pixel IS c, z₀ = 0.
// interior% — pixels that never escape. entropy% — normalized Shannon entropy of
// the escape-count histogram: HIGH ⇒ many counts well-spread (rich filigree),
// LOW ⇒ one bin dominates (all-black, all-cream, or cream + sparse dust). Entropy
// (unlike adjacent-diff richness) is NOT fooled by scattered specks.
function frameMetrics(c: Center, zoom: number): { interior: number; entropy: number } {
  const max = maxIterFor(zoom);
  const scale = BASE_SPAN / zoom / RES;
  const ox = c.re - (RES / 2) * scale;
  const oy = c.im - (RES / 2) * scale;
  const hist = new Map<number, number>();
  let interiorPx = 0;
  const total = RES * RES;
  for (let py = 0; py < RES; py++) {
    const planeY = oy + py * scale;
    for (let px = 0; px < RES; px++) {
      const planeX = ox + px * scale;
      const n = escapeCount(0, 0, planeX, planeY, max, false);
      if (n >= max) interiorPx++;
      hist.set(n, (hist.get(n) ?? 0) + 1);
    }
  }
  let h = 0;
  for (const count of hist.values()) {
    const p = count / total;
    h -= p * Math.log2(p);
  }
  // Normalize against the max possible entropy for this many distinct counts.
  const norm = Math.log2(Math.max(2, max + 1));
  return { interior: (100 * interiorPx) / total, entropy: (100 * h) / norm };
}

describe("fractal-dive center probe", () => {
  it("reports interior% / entropy% across a deep-zoom sweep", () => {
    const header = ["zoom", ...ZOOM_EXPONENTS.map((e) => `1e${e}`)].join("\t");
    const lines: string[] = [];
    for (const c of CENTERS) {
      const cells = ZOOM_EXPONENTS.map((e) => {
        const m = frameMetrics(c, Math.pow(10, e));
        return `${m.interior.toFixed(0)}/${m.entropy.toFixed(0)}`;
      });
      lines.push([c.name.padEnd(14), ...cells].join("\t"));
    }
    // eslint-disable-next-line no-console
    console.log(
      `\nMandelbrot deep-zoom — interior%/entropy% per (center × zoom)\n${header}\n${lines.join("\n")}\n`,
    );
    expect(lines.length).toBe(CENTERS.length);
  });

  // The chosen dive center must keep detail (entropy) at every scale — an
  // approximate boundary coord sinks to the black body or thins to dust (even
  // the famous seahorse point sinks by 1e8). The misiu-spiral Misiurewicz point
  // sustains entropy ~40 with 0% interior from 1e0 down to the float64 wall.
  it("misiu-spiral sustains detail through the whole dive", () => {
    for (const e of [3, 5, 7, 9, 11, 13]) {
      const m = frameMetrics(
        { name: "x", re: -0.10109636384562, im: 0.95628651080914 },
        Math.pow(10, e),
      );
      expect(m.entropy, `entropy at 1e${e}`).toBeGreaterThan(25);
      expect(m.interior, `interior at 1e${e}`).toBeLessThan(20);
    }
  });
});
