/* Canvas backend — materialize a Surface onto a <canvas>.
 *
 * The same pure cell buffer the HTML backend renders, drawn instead as
 * exact square cells on a canvas. This is the right backend when the grid
 * is fine enough that per-cell <pre> glyphs would be sub-readable: a
 * 240×240 buffer scaled into a 600px box is 2.5px cells — pixels, not
 * text. Each cell fills its square; a large enough cell can also draw its
 * glyph. No per-cell handlers — the purity rule holds here too.
 */

import type { Surface } from "./surface";

export type CanvasRenderOpts = {
  // Painted once behind the whole buffer; omit to clear to transparent.
  background?: string;
  // Draw each cell's glyph (true) vs. fill the cell with its fg (false).
  // Glyph mode only makes sense when cells are large; the lens picks.
  drawGlyphs?: boolean;
};

export function renderToCanvas(
  s: Surface,
  canvas: HTMLCanvasElement,
  opts: CanvasRenderOpts = {},
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.clearRect(0, 0, W, H);
  }

  const cw = W / s.w;
  const ch = H / s.h;
  const drawGlyphs = opts.drawGlyphs ?? false;
  if (drawGlyphs) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.floor(ch * 0.9)}px "JetBrains Mono", ui-monospace, monospace`;
  }

  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const cell = s.cells[y * s.w + x];
      if (!cell) continue;
      const px = x * cw;
      const py = y * ch;
      if (cell.bg) {
        ctx.fillStyle = cell.bg;
        ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
      }
      if (cell.glyph === " " || cell.glyph === "") continue;
      ctx.globalAlpha = cell.dim ? 0.5 : 1;
      ctx.fillStyle = cell.fg ?? "#ffffff";
      if (drawGlyphs) {
        ctx.fillText(cell.glyph, px + cw / 2, py + ch / 2);
      } else {
        ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
      }
      ctx.globalAlpha = 1;
    }
  }
}
