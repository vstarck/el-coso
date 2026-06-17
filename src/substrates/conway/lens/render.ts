/* Conway grid render. Wrap-aware: when an axis is wrapped, the world is
 * tiled on that axis so panning past an edge reveals the same pattern
 * shifted. Caller supplies the destination context and the pan offset
 * (in CSS pixels — the lens never knows about canvas-vs-world transform). */

import type { SubstrateState } from "../engine";

// Grid line opacity — visible enough that empty regions still feel like
// "something is out there", faint enough that live cells dominate.
const GRID_ALPHA = 0.06;
const GRID_ALPHA_MAJOR = 0.12;
const GRID_MAJOR_EVERY = 10; // every 10th line a touch louder, for scale

export type ConwayRenderOpts = {
  cell_px: number;
  pan: { x: number; y: number };
  wrap_x: boolean;
  wrap_y: boolean;
  cell_color: string;
  show_tick_counter: boolean;
  // SAFE_AREA inset (CSS pixels). The tick counter dodges these edges so
  // it stays visible when chrome panels open over the canvas.
  inset: { top: number; right: number; bottom: number; left: number };
};

export function drawConwayFrame(
  state: SubstrateState,
  ctx: CanvasRenderingContext2D,
  opts: ConwayRenderOpts,
): void {
  const W = state.W;
  const H = state.H;
  const cell_px = opts.cell_px;
  const W_px = W * cell_px;
  const H_px = H * cell_px;
  const canvas_w = ctx.canvas.width;
  const canvas_h = ctx.canvas.height;

  ctx.fillStyle = "#08090b";
  ctx.fillRect(0, 0, canvas_w, canvas_h);

  // Pan-aware tile placement. For a wrapped axis we draw the world twice
  // (offset by ±W_px) so the visible region is always fully covered no
  // matter where pan lands. For a wall axis we draw once at the raw pan.
  const pan_x = opts.wrap_x ? ((opts.pan.x % W_px) + W_px) % W_px : opts.pan.x;
  const pan_y = opts.wrap_y ? ((opts.pan.y % H_px) + H_px) % H_px : opts.pan.y;
  const x_tiles = opts.wrap_x ? [0, W_px] : [0];
  const y_tiles = opts.wrap_y ? [0, H_px] : [0];

  for (const ty of y_tiles) {
    for (const tx of x_tiles) {
      ctx.save();
      ctx.translate(tx - pan_x, ty - pan_y);
      // View-cull rows/cols outside the destination rect.
      const x_lo = Math.max(0, Math.floor((pan_x - tx) / cell_px));
      const x_hi = Math.min(W, Math.ceil((pan_x - tx + canvas_w) / cell_px));
      const y_lo = Math.max(0, Math.floor((pan_y - ty) / cell_px));
      const y_hi = Math.min(H, Math.ceil((pan_y - ty + canvas_h) / cell_px));

      // Grid: faint per-cell lines so empty regions still feel like a
      // populated substrate. Minor + major lines for scale.
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x_lo; x <= x_hi; x++) {
        if (x % GRID_MAJOR_EVERY === 0) continue;
        ctx.moveTo(x * cell_px + 0.5, y_lo * cell_px);
        ctx.lineTo(x * cell_px + 0.5, y_hi * cell_px);
      }
      for (let y = y_lo; y <= y_hi; y++) {
        if (y % GRID_MAJOR_EVERY === 0) continue;
        ctx.moveTo(x_lo * cell_px, y * cell_px + 0.5);
        ctx.lineTo(x_hi * cell_px, y * cell_px + 0.5);
      }
      ctx.strokeStyle = `rgba(255, 255, 255, ${GRID_ALPHA})`;
      ctx.stroke();

      ctx.beginPath();
      for (let x = x_lo; x <= x_hi; x++) {
        if (x % GRID_MAJOR_EVERY !== 0) continue;
        ctx.moveTo(x * cell_px + 0.5, y_lo * cell_px);
        ctx.lineTo(x * cell_px + 0.5, y_hi * cell_px);
      }
      for (let y = y_lo; y <= y_hi; y++) {
        if (y % GRID_MAJOR_EVERY !== 0) continue;
        ctx.moveTo(x_lo * cell_px, y * cell_px + 0.5);
        ctx.lineTo(x_hi * cell_px, y * cell_px + 0.5);
      }
      ctx.strokeStyle = `rgba(255, 255, 255, ${GRID_ALPHA_MAJOR})`;
      ctx.stroke();

      // Live cells.
      ctx.fillStyle = opts.cell_color;
      for (let y = y_lo; y < y_hi; y++) {
        const row_off = y * W;
        for (let x = x_lo; x < x_hi; x++) {
          if (state.cells[row_off + x] === 1) {
            ctx.fillRect(x * cell_px, y * cell_px, cell_px, cell_px);
          }
        }
      }
      ctx.restore();
    }
  }

  if (opts.show_tick_counter) {
    ctx.fillStyle = "rgba(250, 250, 250, 0.65)";
    ctx.font = "11px 'Geist Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`gen ${state.tick}`, opts.inset.left, opts.inset.top);
  }
}
