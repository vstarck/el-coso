/* Example substrate render. Each cell's counter value drives a hue
 * along blue→amber; tick counter dodges the SAFE_AREA-published inset.
 *
 * Real substrates structure the render pass however the substrate's
 * vocabulary wants — conway walks a flat byte grid; another might
 * interleave agents over a field, or do an isometric painter pass.
 * This file is intentionally one screenful so the design-questions
 * pipeline shows through. */

import type { SubstrateState } from "../engine";

export type ExampleRenderOpts = {
  cell_px: number;
  pan: { x: number; y: number };
  show_tick_counter: boolean;
  inset: { top: number; right: number; bottom: number; left: number };
};

const COLOR_BG = "#0b0d12";
const COLOR_GRID = "rgba(255, 255, 255, 0.05)";

export function drawExampleFrame(
  state: SubstrateState,
  ctx: CanvasRenderingContext2D,
  opts: ExampleRenderOpts,
): void {
  const W = state.W;
  const H = state.H;
  const cell_px = opts.cell_px;
  const canvas_w = ctx.canvas.width;
  const canvas_h = ctx.canvas.height;

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, canvas_w, canvas_h);

  ctx.save();
  ctx.translate(-opts.pan.x, -opts.pan.y);

  // Cells colored by counter modulo a hue range. Higher counter = warmer.
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const v = state.counter[row + x] ?? 0;
      // Cycle every 1000 ticks so a long autoplay run still has visible
      // variation rather than saturating to a single color.
      const t = (v % 1000) / 1000;
      const hue = 210 - 180 * t;
      ctx.fillStyle = `hsl(${hue.toFixed(0)} 60% ${(20 + 30 * t).toFixed(0)}%)`;
      ctx.fillRect(x * cell_px, y * cell_px, cell_px, cell_px);
    }
  }

  // Grid lines for legibility.
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cell_px, 0);
    ctx.lineTo(x * cell_px, H * cell_px);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell_px);
    ctx.lineTo(W * cell_px, y * cell_px);
    ctx.stroke();
  }

  ctx.restore();

  // SAFE_AREA HUD — dodges chrome panels.
  if (opts.show_tick_counter) {
    ctx.fillStyle = "rgba(250, 250, 250, 0.7)";
    ctx.font = "11px 'Geist Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`tick ${state.tick}`, opts.inset.left, opts.inset.top);
  }
}
