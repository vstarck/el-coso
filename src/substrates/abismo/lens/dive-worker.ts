/* Off-main-thread escape-time render for the dive. The main thread can't compute
 * a deep fractal frame without stalling scroll/tick (a depth-12 frame is ~100ms);
 * this worker does it in the background so the main thread only ever REPROJECTS
 * (a ~0.1ms drawImage) and swaps in a fresh base when it arrives. `renderFractal`
 * is pure + buffer-out, so it drops in here unchanged.
 *
 * Protocol: main posts a DiveJob; the worker renders into an RGBA buffer, wraps it
 * in an ImageBitmap (GPU-uploadable, transferable ⇒ zero-copy back), and posts
 * {reqId, bmp, depth, margin, w, h}. One job at a time; the lens coalesces.
 */

import { CYCLIC_PALETTES, renderFractal } from "@/lib/fractal";

export type DiveJob = {
  reqId: number;
  w: number;
  h: number;
  zoom: number;
  max_iter: number;
  center_re: number;
  center_im: number;
  period: number;
  palette: string;
  color_density: number;
  depth: number; // anchor depth (echoed back for reprojection math)
  margin: number; // echoed back
};

export type DiveResult = {
  reqId: number;
  bmp: ImageBitmap;
  depth: number;
  margin: number;
  w: number;
  h: number;
};

// The worker global — typed minimally (the tsconfig ships the DOM lib, not
// WebWorker, so `DedicatedWorkerGlobalScope` isn't available and would clash with
// DOM's `self` anyway). Only the two members we use.
type WorkerScope = {
  onmessage: ((e: MessageEvent<DiveJob>) => void) | null;
  postMessage: (msg: DiveResult, transfer: Transferable[]) => void;
};
// eslint-disable-next-line no-restricted-globals
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e: MessageEvent<DiveJob>): void => {
  const j = e.data;
  const data = new Uint8ClampedArray(j.w * j.h * 4);
  renderFractal(data, j.w, j.h, {
    mode: "mandelbrot",
    c_re: 0,
    c_im: 0,
    center_re: j.center_re,
    center_im: j.center_im,
    zoom: j.zoom,
    max_iter: j.max_iter,
    palette: "fire", // ignored on the cyclic path
    smooth: true,
    color_density: j.color_density,
    cyclic: {
      period: j.period,
      palette: CYCLIC_PALETTES[j.palette] ?? CYCLIC_PALETTES["ink"]!,
    },
  });
  const img = new ImageData(data, j.w, j.h);
  void createImageBitmap(img).then((bmp) => {
    const result: DiveResult = {
      reqId: j.reqId,
      bmp,
      depth: j.depth,
      margin: j.margin,
      w: j.w,
      h: j.h,
    };
    ctx.postMessage(result, [bmp]);
  });
};
