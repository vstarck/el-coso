/* Render — columns → ASCII cell buffer → canvas.
 *
 * Takes the raycaster's per-column hits and paints a styled cell buffer (the
 * spec/24 ASCII IR): ceiling and floor as cheap vertical bg gradients, walls as
 * a distance-faded glyph ramp tinted by wall kind and darkened on E/W faces. The
 * buffer is then drawn to a <canvas> with the ASCII kit's canvas backend in
 * glyph mode — 120 colored characters wide, the way the user asked for it.
 *
 * The surface is allocated once and mutated in place each frame (every cell is
 * fully repainted, so there's nothing stale and no per-frame allocation).
 */

import { makeSurface, renderToCanvas, type Surface } from "@/lib/ascii";
import type { TfpsConfig } from "../engine/config";
import type { Column } from "@/lib/raycast";
import type { TfpsTheme } from "./theme";

// Distance-faded wall glyphs, densest (nearest) first. Pure ASCII.
const WALL_RAMP = "@%#*+=~:-. ";

export type ViewDims = { cols: number; rows: number };

export function makeViewSurface(dims: ViewDims): Surface {
  return makeSurface(dims.cols, dims.rows);
}

// --- color helpers (small, local; the kit's hexToRgba is alpha-only) ----------
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function rgbStr(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
function shade(hex: string, f: number): string {
  const [r, g, b] = hexRgb(hex);
  return rgbStr(r * f, g * f, b * f);
}
function lerp(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  return rgbStr(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

// Brightness as a function of perpendicular distance: near = full, fading with
// depth (and never to pure zero, so far walls keep a faint edge).
function distFactor(dist: number): number {
  return Math.max(0.12, Math.min(1, 1.5 / (1 + dist * 0.22)));
}

function rampGlyphFor(f: number): string {
  const i = Math.round((1 - f) * (WALL_RAMP.length - 1));
  return WALL_RAMP[Math.max(0, Math.min(WALL_RAMP.length - 1, i))] ?? " ";
}

export type PaintOpts = {
  cols: Column[];
  theme: TfpsTheme;
  // HUD status line, painted along the bottom row in the accent color.
  hud?: string;
};

// Paint one frame into `s`. `s.w` must equal cols.length.
export function paintScene(s: Surface, opts: PaintOpts): void {
  const { cols, theme } = opts;
  const W = s.w;
  const H = s.h;
  const horizon = H / 2;

  // Precompute the ceiling/floor gradient color for every row (one band array,
  // ceiling above the horizon, floor below), shared across all columns.
  const band: string[] = new Array(H);
  for (let y = 0; y < H; y++) {
    band[y] =
      y < horizon
        ? lerp(theme.ceilingTop, theme.ceilingBottom, y / horizon)
        : lerp(theme.floorFar, theme.floorNear, (y - horizon) / (H - horizon));
  }

  for (let x = 0; x < W; x++) {
    const col = cols[x]!;
    const f0 = distFactor(col.dist);
    const f = col.side === 1 ? f0 * 0.66 : f0; // E/W faces darker
    const base = theme.walls[col.tile] ?? theme.walls[1] ?? "#ffffff";
    const wallFg = shade(base, f);
    const wallBg = shade(base, f * 0.16); // faint fill behind the glyph
    const glyph = rampGlyphFor(f);

    // Wall strip height in rows: Hc / perpDist (correct in cell units), centered.
    const lineH = Math.min(H, Math.round(H / col.dist));
    const start = Math.floor((H - lineH) / 2);
    const end = start + lineH;

    for (let y = 0; y < H; y++) {
      const cell = s.cells[y * W + x]!;
      if (y >= start && y < end) {
        cell.glyph = glyph;
        cell.fg = wallFg;
        cell.bg = wallBg;
      } else {
        // Ceiling / floor: a space over the gradient band (fg unused for a
        // blank glyph, so any leftover wall fg is harmless).
        cell.glyph = " ";
        cell.bg = band[y]!;
      }
    }
  }

  // HUD — a single status line along the bottom, accent over a dim band.
  if (opts.hud) {
    const y = H - 1;
    const text = opts.hud;
    for (let x = 0; x < W; x++) {
      const cell = s.cells[y * W + x]!;
      cell.bg = "#000000";
      cell.fg = theme.accent;
      cell.glyph = text[x] ?? " ";
    }
  }
}

// --- Minimap HUD -------------------------------------------------------------
// A small ASCII automap, drawn over the top-right corner: a player-centered
// window of the world (so it works for any map size, and is the seed for a
// future fog-of-war / zoomable map). The player sits at the center as an
// 8-direction heading arrow.

const FRAME = {
  tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│",
} as const;
// angle 0 = east; +π/2 = south (y down). Index by eighths of a turn.
const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"] as const;

function headingArrow(angle: number): string {
  const turn = (((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const idx = Math.round(turn / (Math.PI / 4)) % 8;
  return ARROWS[idx] ?? "→";
}

export type MinimapOpts = {
  config: TfpsConfig;
  px: number;
  py: number;
  angle: number;
  theme: TfpsTheme;
  size?: number; // square side in cells (default 20)
};

// Paint the minimap into the top-right `size`×`size` block of `s`. Fully
// overwrites that region each frame (nothing stale).
export function paintMinimap(s: Surface, o: MinimapOpts): void {
  const size = o.size ?? 20;
  const ox = s.w - size;
  const oy = 0;
  const half = Math.floor((size - 2) / 2); // interior radius (center on player)
  const cx = Math.floor(o.px);
  const cy = Math.floor(o.py);
  const panelBg = "#070b14";
  const frameFg = shade(o.theme.accent, 0.6);
  const accent = o.theme.accent;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cell = s.cells[(oy + j) * s.w + (ox + i)]!;
      cell.bg = panelBg;

      // Frame.
      if (i === 0 || j === 0 || i === size - 1 || j === size - 1) {
        cell.fg = frameFg;
        cell.glyph =
          j === 0 && i === 0
            ? FRAME.tl
            : j === 0 && i === size - 1
              ? FRAME.tr
              : j === size - 1 && i === 0
                ? FRAME.bl
                : j === size - 1 && i === size - 1
                  ? FRAME.br
                  : j === 0 || j === size - 1
                    ? FRAME.h
                    : FRAME.v;
        continue;
      }

      const ii = i - 1;
      const jj = j - 1;
      // Player marker dead center.
      if (ii === half && jj === half) {
        cell.bg = shade(accent, 0.3);
        cell.fg = accent;
        cell.glyph = headingArrow(o.angle);
        continue;
      }

      const mx = cx - half + ii;
      const my = cy - half + jj;
      if (mx < 0 || my < 0 || mx >= o.config.mapW || my >= o.config.mapH) {
        cell.glyph = " "; // beyond the world edge
        continue;
      }
      const tile = o.config.map[my * o.config.mapW + mx] ?? 0;
      if (tile !== 0) {
        cell.glyph = "█";
        cell.fg = shade(o.theme.walls[tile] ?? o.theme.walls[1] ?? "#888", 0.85);
      } else {
        cell.glyph = "·";
        cell.fg = shade(accent, 0.18);
      }
    }
  }
}

// Draw the painted surface onto the canvas (glyph mode — colored characters).
export function drawSurface(s: Surface, canvas: HTMLCanvasElement, bg: string): void {
  renderToCanvas(s, canvas, { background: bg, drawGlyphs: true });
}
