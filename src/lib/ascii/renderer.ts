/* SurfaceRenderer — the backend seam for painting an ascii `Surface`.
 *
 * The `Surface` cell buffer is already the backend-agnostic IR (it's why this kit
 * ships both a canvas and an <pre> backend). This formalizes a stateful renderer
 * object that OWNS its canvas context, so different backends are swappable behind
 * one interface without any change upstream (raycast → paintScene → Surface):
 *
 *   makeCanvasTextRenderer   per-cell fillRect + fillText (baseline)
 *   makeCanvasAtlasRenderer  glyph-cache + drawImage        (later — perf)
 *   makeGlRenderer           instanced glyph-atlas, WebGL   (later — no ceiling)
 *
 * Contract that keeps the WebGL swap free: the caller hands over a BARE <canvas>
 * and never calls getContext itself (a canvas locks to one context type on first
 * getContext). A 2D backend claims "2d"; a future GL backend claims "webgl2".
 * See context/substrates/nm5/render-spec.md.
 */

import type { Surface } from "./surface";
import { renderToCanvas } from "./canvas-backend";

export { makeCanvasAtlasRenderer } from "./canvas-atlas-backend";
export { makeGlRenderer } from "./gl-backend";

export type SurfaceRendererOpts = {
  // Device-pixel backing size the renderer draws at (CSS size stays caller-owned).
  width: number;
  height: number;
  // Painted behind the whole buffer; also settable via setBackground (theme swap).
  background?: string;
  // Monospace family — used by the atlas / GL backends. The text backend below
  // uses renderToCanvas's built-in font and ignores this.
  font?: string;
  // Optional glyph set to pre-warm the cache (atlas) / pre-pack the texture (GL).
  // Ignored by the text backend.
  glyphs?: string;
};

export type SurfaceRenderer = {
  // Paint the cell buffer to the owned canvas.
  render(surface: Surface): void;
  // Backing store changed (resize / dpr change).
  resize(width: number, height: number): void;
  // Update the clear colour (theme swap).
  setBackground(color: string): void;
  // Free any held resources (cache / GL context).
  dispose(): void;
  // Optional backend diagnostics for a dev/console readout — named counters
  // (cache sizes, etc.), keys backend-defined. Absent ⇒ no diagnostics offered
  // (the text backend has no cache to report). The atlas reports its live strip-
  // tile and colour-key cache sizes, so a console `profile` command can watch the
  // colour-key set grow under shimmer (the unbounded-cache tell) or stay bounded.
  stats?: () => Record<string, number>;
};

export type SurfaceRendererFactory = (
  canvas: HTMLCanvasElement,
  opts: SurfaceRendererOpts,
) => SurfaceRenderer;

// Baseline backend: per-cell fillRect + fillText, via renderToCanvas. Sets the
// backing size and owns the canvas's 2D usage for its lifetime. `font`/`glyphs`
// are ignored here (the atlas/GL backends consume them). Behaviour is identical
// to the previous direct `renderToCanvas(..., { drawGlyphs: true })` call.
export const makeCanvasTextRenderer: SurfaceRendererFactory = (canvas, opts) => {
  canvas.width = opts.width;
  canvas.height = opts.height;
  let background = opts.background;
  return {
    render: (s) =>
      renderToCanvas(s, canvas, {
        drawGlyphs: true,
        ...(background !== undefined ? { background } : {}),
      }),
    resize: (w, h) => {
      canvas.width = w;
      canvas.height = h;
    },
    setBackground: (c) => {
      background = c;
    },
    dispose: () => {},
  };
};
