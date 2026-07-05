/* The dive painter — CPU float64 escape-time (the ONLY path that reaches 1e12; a
 * GL float32 shader blurs out by ~1e4).
 *
 * ── Zoom coherence + off-thread render (the flow architecture) ────────────────
 * Successive dive frames are the SAME image at different magnification (fixed
 * center, no pan ⇒ a pure similarity): the frame at depth d+δ is the central
 * 10^-δ crop of the frame at d, blown up ×10^δ. So we keep the last COMPUTED
 * frame as a `base` (an ImageBitmap) and every display frame just `drawImage`s a
 * center-crop of it to the viewport — ~0.1ms, exact but for a sampling softness
 * ∝ |depth − baseDepth| that motion hides.
 *
 * The escape-time render itself runs in a WORKER, so the main thread NEVER blocks
 * on it — the stutter a synchronous deep-frame render caused. The lens requests a
 * re-anchor whenever the worker is free and the view has drifted; when the fresh
 * base arrives it's swapped in. One quality level (no motion/rest split ⇒ no
 * visible sharpen pop): SSAA is folded into the base being rendered `ssaa`× denser
 * than the display, so the present blit downsamples = anti-aliasing for free.
 *
 * The base is rendered `margin`× WIDER than shown so a zoom-OUT can still crop
 * from it (reprojection only ADDS magnification, never reveals un-captured area).
 * A synchronous first frame + a synchronous fallback keep it working before the
 * worker warms up and in environments without Workers (headless tests).
 */

import DiveWorkerCtor from "./dive-worker?worker&inline";
import type { DiveJob, DiveResult } from "./dive-worker";
import { CYCLIC_PALETTES, renderFractal } from "@/lib/fractal";

export type DiveBaseParams = {
  center_re: number;
  center_im: number;
  depth: number; // display depth this base is anchored at
  dispW: number; // display (viewport) size in px
  dispH: number;
  ssaa: number; // supersample factor (base rendered this× denser than display)
  margin: number; // base covers margin× the viewport span (zoom-out headroom)
  iter_base: number;
  iter_per_depth: number;
  period: number;
  palette: string; // a CYCLIC_PALETTES name
  color_density: number;
};

export type DivePainter = {
  // Ask for a fresh base anchored at p.depth. Off-thread when a worker is up (the
  // base updates when it arrives); synchronous for the first frame + as fallback.
  requestBase(p: DiveBaseParams): void;
  // Cheap: paint the stored base reprojected from its anchor depth to `curDepth`.
  present(curDepth: number, dispW: number, dispH: number): void;
  hasBase(): boolean;
  isPending(): boolean; // a worker render is in flight (don't pile on)
  baseDepth(): number;
  invalidate(): void; // drop the base (hard reset)
  destroy(): void;
};

type BaseSource = ImageBitmap | HTMLCanvasElement;

function isBitmap(s: BaseSource | null): s is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && s instanceof ImageBitmap;
}

// Base pixel dimensions for a request: display × margin × ssaa (SSAA folded in).
function baseDims(p: DiveBaseParams): { bw: number; bh: number } {
  return {
    bw: Math.max(1, Math.round(p.dispW * p.margin * p.ssaa)),
    bh: Math.max(1, Math.round(p.dispH * p.margin * p.ssaa)),
  };
}

export function makeDivePainter(canvas: HTMLCanvasElement): DivePainter {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("abismo: could not acquire 2d context");

  let base: BaseSource | null = null;
  let baseAnchor = 0;
  let baseMargin = 1;
  let baseW = 1;
  let baseH = 1;

  // Sync-fallback scratch (created lazily; also backs the synchronous first frame).
  let syncCanvas: HTMLCanvasElement | null = null;
  let syncImg: ImageData | null = null;

  // Worker plumbing.
  let worker: Worker | null = null;
  let pending = false;
  let reqSeq = 0;
  let queued: DiveBaseParams | null = null;

  function adopt(src: BaseSource, depth: number, margin: number, w: number, h: number): void {
    if (base && isBitmap(base) && base !== src) base.close();
    base = src;
    baseAnchor = depth;
    baseMargin = margin;
    baseW = w;
    baseH = h;
  }

  function post(p: DiveBaseParams): void {
    if (!worker) return;
    const { bw, bh } = baseDims(p);
    reqSeq++;
    const job: DiveJob = {
      reqId: reqSeq,
      w: bw,
      h: bh,
      zoom: Math.pow(10, p.depth) / p.margin, // margin× wider view
      max_iter: Math.round(p.iter_base + p.iter_per_depth * p.depth),
      center_re: p.center_re,
      center_im: p.center_im,
      period: p.period,
      palette: p.palette,
      color_density: p.color_density,
      depth: p.depth,
      margin: p.margin,
    };
    pending = true;
    worker.postMessage(job);
  }

  function renderSync(p: DiveBaseParams): void {
    const { bw, bh } = baseDims(p);
    if (!syncCanvas) syncCanvas = document.createElement("canvas");
    if (syncCanvas.width !== bw || syncCanvas.height !== bh) {
      syncCanvas.width = bw;
      syncCanvas.height = bh;
    }
    const sctx = syncCanvas.getContext("2d");
    if (!sctx) return;
    if (!syncImg || syncImg.width !== bw || syncImg.height !== bh) {
      syncImg = sctx.createImageData(bw, bh);
    }
    renderFractal(syncImg.data, bw, bh, {
      mode: "mandelbrot",
      c_re: 0,
      c_im: 0,
      center_re: p.center_re,
      center_im: p.center_im,
      zoom: Math.pow(10, p.depth) / p.margin,
      max_iter: Math.round(p.iter_base + p.iter_per_depth * p.depth),
      palette: "fire",
      smooth: true,
      color_density: p.color_density,
      cyclic: {
        period: p.period,
        palette: CYCLIC_PALETTES[p.palette] ?? CYCLIC_PALETTES["ink"]!,
      },
    });
    sctx.putImageData(syncImg, 0, 0);
    adopt(syncCanvas, p.depth, p.margin, bw, bh);
  }

  // Bring up the worker (guarded — absent in node/headless and very old browsers).
  try {
    if (typeof Worker !== "undefined") {
      worker = new DiveWorkerCtor();
      worker.onmessage = (e: MessageEvent<DiveResult>): void => {
        const r = e.data;
        if (r.reqId === reqSeq) {
          adopt(r.bmp, r.depth, r.margin, r.w, r.h);
        } else {
          r.bmp.close(); // a newer request superseded this one
        }
        pending = false;
        if (queued) {
          const q = queued;
          queued = null;
          post(q);
        }
      };
    }
  } catch {
    worker = null; // fall back to synchronous rendering
  }

  return {
    requestBase(p): void {
      // First frame is always synchronous ⇒ no black flash while the worker warms.
      if (!base || !worker) {
        renderSync(p);
        return;
      }
      if (pending) {
        queued = p; // coalesce to the newest request
        return;
      }
      post(p);
    },
    present(curDepth, dispW, dispH): void {
      if (canvas.width !== dispW || canvas.height !== dispH) {
        canvas.width = dispW;
        canvas.height = dispH;
      }
      ctx.clearRect(0, 0, dispW, dispH);
      if (!base) return;
      // Linear fraction of the base the current view occupies: the view spans
      // span(curDepth) = span(baseAnchor)·10^(baseAnchor−curDepth); the base covers
      // margin× span(baseAnchor). SSAA cancels out of the fraction.
      let frac = Math.pow(10, baseAnchor - curDepth) / baseMargin;
      frac = frac > 1 ? 1 : frac < 1e-9 ? 1e-9 : frac; // guard (re-anchor keeps <1)
      const cw = baseW * frac;
      const ch = baseH * frac;
      const cx = (baseW - cw) / 2;
      const cy = (baseH - ch) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high"; // SSAA downsample on the present blit
      ctx.drawImage(base, cx, cy, cw, ch, 0, 0, dispW, dispH);
    },
    hasBase: () => base !== null,
    isPending: () => pending,
    baseDepth: () => baseAnchor,
    invalidate(): void {
      if (base && isBitmap(base)) base.close();
      base = null;
    },
    destroy(): void {
      if (base && isBitmap(base)) base.close();
      base = null;
      queued = null;
      if (worker) {
        worker.terminate();
        worker = null;
      }
    },
  };
}
