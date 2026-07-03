/* Locks the zoom-coherence math in the abismo painter: a base rendered at depth
 * d, then PRESENTED at d, must reproduce a direct render at d (the reprojection
 * is exact at its anchor — margin 1, ssaa 1 ⇒ a 1:1 blit). Runs headless by
 * stubbing document.createElement("canvas") → node-canvas.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "canvas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === "canvas") return createCanvas(1, 1);
    throw new Error(`stub document: only <canvas>, got <${tag}>`);
  },
};

// Imported AFTER the document stub so the painter's module-load side effects (none
// today, but defensive) see it.
import { makeDivePainter } from "../src/substrates/abismo/lens/painter";
import { CYCLIC_PALETTES, renderFractal } from "../src/lib/fractal";

const CENTER = { re: -0.10109636384562, im: 0.95628651080914 };
const W = 120;
const H = 90;

function directFrame(depth: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  renderFractal(data, W, H, {
    mode: "mandelbrot",
    c_re: 0,
    c_im: 0,
    center_re: CENTER.re,
    center_im: CENTER.im,
    zoom: Math.pow(10, depth),
    max_iter: Math.round(200 + 120 * depth),
    palette: "fire",
    smooth: true,
    color_density: 0.35,
    cyclic: { period: 32, palette: CYCLIC_PALETTES["ink"]! },
  });
  return data;
}

function meanChannelError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue; // skip alpha
    sum += Math.abs(a[i]! - b[i]!);
    n++;
  }
  return sum / n;
}

describe("abismo painter — zoom coherence", () => {
  it("present at the anchor depth reproduces a direct render (margin 1, ssaa 1)", () => {
    const disp = createCanvas(W, H) as unknown as HTMLCanvasElement;
    const painter = makeDivePainter(disp);
    const depth = 1.5;
    painter.requestBase({
      center_re: CENTER.re,
      center_im: CENTER.im,
      depth,
      dispW: W,
      dispH: H,
      ssaa: 1,
      margin: 1, // no widening ⇒ present frac = 1 ⇒ a 1:1 blit
      iter_base: 200,
      iter_per_depth: 120,
      period: 32,
      palette: "ink",
      color_density: 0.35,
    });
    expect(painter.hasBase()).toBe(true);
    expect(painter.baseDepth()).toBe(depth);

    painter.present(depth, W, H);
    const ctx = (disp as unknown as ReturnType<typeof createCanvas>).getContext("2d");
    const got = ctx.getImageData(0, 0, W, H).data as unknown as Uint8ClampedArray;
    const want = directFrame(depth);

    // Two blits (SSAA downsample at 1:1 + present at 1:1) round-trip the pixels;
    // allow a whisker of resampling noise but demand near-identity.
    expect(meanChannelError(got, want)).toBeLessThan(3);
  });

  it("clears to black before any base is rendered", () => {
    const disp = createCanvas(W, H) as unknown as HTMLCanvasElement;
    const painter = makeDivePainter(disp);
    expect(painter.hasBase()).toBe(false);
    painter.present(2.0, W, H); // no base yet
    const ctx = (disp as unknown as ReturnType<typeof createCanvas>).getContext("2d");
    const d = ctx.getImageData(0, 0, W, H).data;
    let maxLuma = 0;
    for (let i = 0; i < d.length; i += 4) maxLuma = Math.max(maxLuma, d[i]!, d[i + 1]!, d[i + 2]!);
    expect(maxLuma).toBe(0);
  });

  it("magnifying the base keeps the frame centered + non-blank (crop stays in bounds)", () => {
    const disp = createCanvas(W, H) as unknown as HTMLCanvasElement;
    const painter = makeDivePainter(disp);
    painter.requestBase({
      center_re: CENTER.re,
      center_im: CENTER.im,
      depth: 1.0,
      dispW: W,
      dispH: H,
      ssaa: 1,
      margin: 1.5,
      iter_base: 200,
      iter_per_depth: 120,
      period: 32,
      palette: "ink",
      color_density: 0.35,
    });
    // Present deeper (a zoom-IN crop) — must fill the frame, not leave transparent
    // borders from a source rect running past the base edge.
    painter.present(1.1, W, H);
    const ctx = (disp as unknown as ReturnType<typeof createCanvas>).getContext("2d");
    const d = ctx.getImageData(0, 0, W, H).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 250) opaque++;
    expect(opaque).toBe(W * H); // every pixel painted (no border gaps)
  });
});
