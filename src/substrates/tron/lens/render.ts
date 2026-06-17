/* Tron render. A grid arena bordered by a bright deadly frame; the trail
 * is drawn as filled accent cells, the live head a brighter square, and a
 * SAFE_AREA HUD reads the survival progress. Crash dims the trail. */

import type { SubstrateState } from "../engine";

export type TronRenderOpts = {
  cell_px: number;
  pan: { x: number; y: number };
  accent: string;
  survive_ticks: number;
  show_hud: boolean;
  inset: { top: number; right: number; bottom: number; left: number };
};

const COLOR_BG = "#05070d";
const COLOR_GRID = "rgba(120, 200, 255, 0.05)";

// Trail color by cell owner id: 1 = player (accent, passed in), foe i =
// id i+2 cycles this palette.
const FOE_COLORS = ["#e879f9", "#fb923c", "#a3e635", "#f472b6", "#facc15"];

function ownerColor(owner: number, accent: string): string {
  if (owner === 1) return accent;
  return FOE_COLORS[(owner - 2) % FOE_COLORS.length]!;
}

export function drawTronFrame(
  state: SubstrateState,
  ctx: CanvasRenderingContext2D,
  opts: TronRenderOpts,
): void {
  const W = state.W;
  const H = state.H;
  const cell_px = opts.cell_px;
  const canvas_w = ctx.canvas.width;
  const canvas_h = ctx.canvas.height;
  const dead = state.outcome === "lost";

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, canvas_w, canvas_h);

  ctx.save();
  ctx.translate(-opts.pan.x, -opts.pan.y);

  // Subtle grid lines for spatial reference.
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

  // Trail — every occupied cell, colored by owner. Dim on player death so
  // the crash reads.
  const trail_alpha = dead ? 0.3 : 0.85;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const owner = state.cells[row + x]!;
      if (owner !== 0) {
        ctx.fillStyle = withAlpha(ownerColor(owner, opts.accent), trail_alpha);
        ctx.fillRect(x * cell_px + 1, y * cell_px + 1, cell_px - 2, cell_px - 2);
      }
    }
  }

  // Foe heads — a bright square in the foe's color while alive.
  for (let i = 0; i < state.foes.length; i++) {
    const foe = state.foes[i]!;
    if (foe.alive === 0) continue;
    ctx.fillStyle = brighten(ownerColor(i + 2, opts.accent));
    ctx.fillRect(foe.x * cell_px + 1, foe.y * cell_px + 1, cell_px - 2, cell_px - 2);
  }

  // Player head — a brighter square, red if crashed.
  ctx.fillStyle = dead ? "#ff5566" : "#e8fbff";
  ctx.fillRect(
    state.head_x * cell_px + 1,
    state.head_y * cell_px + 1,
    cell_px - 2,
    cell_px - 2,
  );

  // Deadly border frame around the arena.
  ctx.strokeStyle = withAlpha(opts.accent, 0.9);
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, W * cell_px, H * cell_px);

  ctx.restore();

  // SAFE_AREA HUD — survival progress, dodging chrome panels.
  if (opts.show_hud) {
    ctx.font = "11px 'Geist Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(232, 251, 255, 0.75)";
    ctx.fillText(
      `tick ${state.tick} / ${opts.survive_ticks}`,
      opts.inset.left,
      opts.inset.top,
    );
    if (state.outcome === "won") {
      ctx.fillStyle = "#34d399";
      ctx.fillText("SURVIVED", opts.inset.left, opts.inset.top + 16);
    } else if (state.outcome === "lost") {
      ctx.fillStyle = "#ff5566";
      ctx.fillText("CRASHED", opts.inset.left, opts.inset.top + 16);
    }
  }
}

// Expand a #rrggbb accent to an rgba() string at the given alpha.
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Blend a #rrggbb color 45% toward white for a bright head marker.
function brighten(hex: string): string {
  const h = hex.replace("#", "");
  const mix = (c: number) => Math.round(c + (255 - c) * 0.45);
  const r = mix(parseInt(h.slice(0, 2), 16));
  const g = mix(parseInt(h.slice(2, 4), 16));
  const b = mix(parseInt(h.slice(4, 6), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
