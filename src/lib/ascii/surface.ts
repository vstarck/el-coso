/* The ASCII render IR — a styled cell buffer.
 *
 * A `Surface` is pure data: a row-major grid of cells, each carrying a
 * glyph and optional presentation. No method, no DOM identity, no
 * behavior — that is what makes the render unable to smuggle input. A
 * backend (html-backend.ts) materializes a surface for display; the lens
 * never emits markup directly.
 */

export type Cell = {
  glyph: string; // one visible character
  fg?: string; // CSS color for the glyph
  bg?: string; // CSS color behind the glyph
  bold?: boolean;
  dim?: boolean;
};

export type Surface = {
  w: number;
  h: number;
  cells: Cell[]; // row-major, length w*h
};

const BLANK: Cell = { glyph: " " };

// Allocate a surface, every cell an independent copy of `fill` (default a
// single space). Copies so a later `put` never aliases the fill prototype.
export function makeSurface(w: number, h: number, fill: Cell = BLANK): Surface {
  const cells: Cell[] = new Array(w * h);
  for (let i = 0; i < cells.length; i++) cells[i] = { ...fill };
  return { w, h, cells };
}

// Write one cell. Out-of-bounds is a silent no-op (clipping is the common
// case for a piece hanging over an edge).
export function put(s: Surface, x: number, y: number, cell: Cell): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  s.cells[y * s.w + x] = cell;
}

// Write a string left-to-right from (x, y), one glyph per cell, applying
// `style` to each. Stops at the right edge of the surface.
export function writeText(
  s: Surface,
  x: number,
  y: number,
  text: string,
  style: Omit<Cell, "glyph"> = {},
): void {
  // Spread to code points so multi-unit glyphs (e.g. emoji) occupy one
  // cell rather than splitting across two.
  const glyphs = [...text];
  for (let i = 0; i < glyphs.length; i++) {
    put(s, x + i, y, { glyph: glyphs[i] ?? " ", ...style });
  }
}
