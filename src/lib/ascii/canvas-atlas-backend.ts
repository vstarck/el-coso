/* Canvas glyph-atlas backend — the perf renderer for large ascii grids.
 *
 * Replaces the naive per-cell `fillText` (canvas-backend.ts) with cached blits.
 * The key trick is raycaster-shaped: a vertical run of identical cells (a wall
 * strip is one glyph in one colour, top to bottom) is drawn in ONE `drawImage`
 * from a "strip tile" — the glyph pre-rasterized once, stacked full-column-tall —
 * using a source sub-rectangle sized to the run. This is exactly Wolfenstein 3D's
 * scaled texture-column blit (one column drawn as a unit), a layer up: we hand the
 * scaling to the GPU instead of a fixed-point inner loop. A clean wall column goes
 * from ~rows draw calls to ONE; corruption just splits a column into shorter runs
 * (a length-1 run is a single-cell sub-rect). See render-spec.md + performance.md.
 *
 * Colour is QUANTIZED (default 32 levels/channel) so a moving camera's continuous
 * distance-shading collapses to a bounded palette whose strips cache across frames
 * (without this the cache never warms — novel colours every frame).
 *
 * Backgrounds draw separately, coalescing equal-bg horizontal runs per row into
 * one `fillRect` (a per-row ceiling/floor band becomes ~one rect, not W).
 */

import type { Surface } from "./surface";
import type { SurfaceRendererFactory } from "./renderer";

const DEFAULT_FONT = '"JetBrains Mono", ui-monospace, monospace';
const QUANT_STEP = 8; // 256/8 = 32 levels/channel
const MAX_STRIPS = 2048; // FIFO-evicted safety cap (bounded palette rarely nears it)

// Parse "rgb(r,g,b)" / "rgba(...)" / "#rgb" / "#rrggbb" → [r,g,b] 0–255. Bad
// input falls back to white (never throws — a colour glitch must not kill render).
export function parseCssColor(s: string): [number, number, number] {
  if (!s) return [255, 255, 255];
  if (s.charCodeAt(0) === 35 /* '#' */) {
    const h = s.slice(1);
    const wide = h.length >= 6;
    const r = parseInt(wide ? h.slice(0, 2) : h[0]! + h[0]!, 16);
    const g = parseInt(wide ? h.slice(2, 4) : h[1]! + h[1]!, 16);
    const b = parseInt(wide ? h.slice(4, 6) : h[2]! + h[2]!, 16);
    return [r || 0, g || 0, b || 0];
  }
  const open = s.indexOf("(");
  const close = s.indexOf(")");
  if (open < 0 || close < 0) return [255, 255, 255];
  const p = s.slice(open + 1, close).split(",");
  const n = (i: number): number => {
    const v = parseInt(p[i] ?? "", 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(255, v)) : 0;
  };
  return [n(0), n(1), n(2)];
}

// Snap a channel to `step` levels so continuous shading buckets into a stable
// palette (strip cache hits across frames).
export function quantizeChannel(v: number, step: number = QUANT_STEP): number {
  const q = Math.round(v / step) * step;
  return q < 0 ? 0 : q > 255 ? 255 : q;
}

type TileCanvas = OffscreenCanvas | HTMLCanvasElement;

// Offscreen tile: OffscreenCanvas where available (no DOM attach), else a
// detached <canvas>. Both are valid drawImage sources.
function createTileCanvas(w: number, h: number): TileCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export const makeCanvasAtlasRenderer: SurfaceRendererFactory = (canvas, opts) => {
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("ascii atlas: could not acquire 2d context");
  const fontFamily = opts.font ?? DEFAULT_FONT;
  let background = opts.background;

  // Strip tiles: one glyph, one quantized colour, stacked `rows` cells tall. A
  // run of h cells blits the top h cells via a source sub-rect.
  const strips = new Map<string, TileCanvas>();
  const colorKeys = new Map<string, string>(); // raw fg string → "qr,qg,qb"
  let lastCw = 0;
  let lastCh = 0;
  let lastRows = 0;
  let lastBlitCalls = 0; // drawImage calls in the most recent render() — the
  // fragmentation signal: a clean grid is ~one blit per column, per-cell noise
  // shatters columns into one blit per cell (the atlas's cost driver).

  function colorKey(fg: string): string {
    let k = colorKeys.get(fg);
    if (k === undefined) {
      const [r, g, b] = parseCssColor(fg);
      k = `${quantizeChannel(r)},${quantizeChannel(g)},${quantizeChannel(b)}`;
      colorKeys.set(fg, k);
    }
    return k;
  }

  // Full-column strip for (glyph, colour, flags): the glyph drawn once per cell,
  // `rows` times, at the current cell size. Built lazily, reused across frames.
  function stripFor(
    glyph: string,
    fg: string,
    dim: boolean,
    bold: boolean,
    cellW: number,
    cellH: number,
    rows: number,
  ): TileCanvas {
    const ck = colorKey(fg);
    const key = `${glyph} ${ck} ${dim ? "d" : ""}${bold ? "b" : ""}`;
    const hit = strips.get(key);
    if (hit) return hit;
    const strip = createTileCanvas(cellW, cellH * rows);
    const sctx = strip.getContext("2d") as CanvasRenderingContext2D | null;
    if (sctx) {
      sctx.textAlign = "center";
      sctx.textBaseline = "middle";
      sctx.font = `${bold ? "700 " : ""}${Math.floor(cellH * 0.9)}px ${fontFamily}`;
      sctx.fillStyle = dim ? `rgba(${ck},0.5)` : `rgb(${ck})`;
      for (let i = 0; i < rows; i++) {
        sctx.fillText(glyph, cellW / 2, i * cellH + cellH / 2);
      }
    }
    if (strips.size >= MAX_STRIPS) {
      const oldest = strips.keys().next().value;
      if (oldest !== undefined) strips.delete(oldest);
    }
    strips.set(key, strip);
    return strip;
  }

  return {
    render(s: Surface): void {
      const W = canvas.width;
      const H = canvas.height;
      const cw = W / s.w;
      const ch = H / s.h;
      const cellW = Math.max(1, Math.ceil(cw)); // integer strip cell size
      const cellH = Math.max(1, Math.ceil(ch));
      // Strips are sized to the cell + row count — invalidate if either changed.
      if (cellW !== lastCw || cellH !== lastCh || s.h !== lastRows) {
        strips.clear();
        lastCw = cellW;
        lastCh = cellH;
        lastRows = s.h;
      }
      let blitCalls = 0; // counted this frame, published to stats() at the end

      if (background !== undefined) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.clearRect(0, 0, W, H);
      }

      // BG pass — coalesce equal-bg horizontal runs into one fillRect per run.
      for (let y = 0; y < s.h; y++) {
        let runStart = 0;
        let runBg: string | undefined;
        const flush = (endX: number): void => {
          if (runBg !== undefined && endX > runStart) {
            ctx.fillStyle = runBg;
            ctx.fillRect(
              Math.floor(runStart * cw),
              Math.floor(y * ch),
              Math.ceil((endX - runStart) * cw) + 1,
              cellH + 1,
            );
          }
        };
        for (let x = 0; x < s.w; x++) {
          const bg = s.cells[y * s.w + x]?.bg;
          if (bg !== runBg) {
            flush(x);
            runStart = x;
            runBg = bg;
          }
        }
        flush(s.w);
      }

      // Glyph pass — column-major vertical-run strip blit. A run of consecutive
      // cells with identical (glyph, fg, flags) draws in ONE drawImage from the
      // top `h` cells of the strip. Comparison is on the raw fields (cheap,
      // reference-equal for a uniform wall column) — the quantized key + strip
      // build happens once per run inside stripFor.
      const blitRun = (
        x: number,
        y0: number,
        h: number,
        glyph: string,
        fg: string,
        dim: boolean,
        bold: boolean,
      ): void => {
        const strip = stripFor(glyph, fg, dim, bold, cellW, cellH, s.h);
        ctx.drawImage(
          strip,
          0,
          0,
          cellW,
          h * cellH, // source: top h cells
          Math.floor(x * cw),
          Math.floor(y0 * ch),
          cellW,
          Math.ceil(h * ch), // dest
        );
        blitCalls++;
      };

      for (let x = 0; x < s.w; x++) {
        let active = false;
        let y0 = 0;
        let rg = "";
        let rf = "";
        let rd = false;
        let rb = false;
        for (let y = 0; y < s.h; y++) {
          const cell = s.cells[y * s.w + x];
          const g = cell?.glyph ?? "";
          if (!cell || g === " " || g === "") {
            if (active) {
              blitRun(x, y0, y - y0, rg, rf, rd, rb);
              active = false;
            }
            continue;
          }
          const fg = cell.fg ?? "#ffffff";
          const dim = !!cell.dim;
          const bold = !!cell.bold;
          if (active && g === rg && fg === rf && dim === rd && bold === rb) {
            continue; // extend the current run
          }
          if (active) blitRun(x, y0, y - y0, rg, rf, rd, rb);
          active = true;
          y0 = y;
          rg = g;
          rf = fg;
          rd = dim;
          rb = bold;
        }
        if (active) blitRun(x, y0, s.h - y0, rg, rf, rd, rb);
      }
      lastBlitCalls = blitCalls;
    },
    resize(w: number, h: number): void {
      canvas.width = w;
      canvas.height = h;
    },
    setBackground(color: string): void {
      background = color;
    },
    // Live diagnostics for a console profiler. `blitCalls` = drawImage calls in
    // the last frame (the fragmentation signal — ~one per column when clean, one
    // per cell under per-cell noise). `strips` is the FIFO-capped tile cache;
    // `colourKeys` is the raw-fg→quantized-key memo, which grows with DISTINCT fg
    // strings (a per-tick shimmering palette defeats it → it climbs every frame;
    // a bounded palette keeps it flat).
    stats(): Record<string, number> {
      return { blitCalls: lastBlitCalls, strips: strips.size, colourKeys: colorKeys.size };
    },
    dispose(): void {
      lastBlitCalls = 0;
      strips.clear();
      colorKeys.clear();
    },
  };
};
