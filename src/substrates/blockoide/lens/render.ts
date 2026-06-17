// Blockoide draw helpers (chrome-tier). The well is built as a styled cell
// buffer (the ASCII IR) and rendered to a <pre> by the mount.
//
// Resolution is configurable: each game cell is drawn as an `ssx × ssy`
// block of characters at a small, still-legible monospace size. A
// monospace glyph is ~0.6 as wide as tall, so a square game cell needs
// ~1.67× more columns than rows (the mount picks `ssx ≈ 1.67·ssy`). Each
// sub-cell is a real, legible character — depth shows as both the cell's
// hue/dimming and (in the `shaded` set) the █▓▒░ ramp glyph — with a 1-char
// bevel (lighter top-left, darker bottom-right) + a 1-char gutter so each
// block reads as a delineated 3D tile rather than one fat glyph.

import { makeSurface, put, rampGlyph, type GlyphSet, type Surface } from "@/lib/ascii";
import {
  landingZ,
  pieceCells,
  pieceExtent,
  WALL,
  type SubstrateState,
} from "../engine";

export type Role = "empty" | "wall" | "block" | "shadow" | "piece";

// Glyph sets — the plastic dictionary. `block` may be a single glyph
// (depth via color only) or a ramp (depth via glyph + color). Glyphs are
// what the ss = 1 readable mode draws; at higher ss the cells are filled
// squares and the glyph is just a non-empty marker.
export const GLYPH_SETS: Record<string, GlyphSet<Role>> = {
  blocks: { empty: "·", wall: "▓", block: "█", shadow: "░", piece: "█" },
  shaded: { empty: "·", wall: "▓", block: ["█", "▓", "▒", "░"], shadow: "░", piece: "█" },
  retro: { empty: ".", wall: "#", block: "#", shadow: ":", piece: "@" },
};

export type GlyphSetId = keyof typeof GLYPH_SETS & string;

// Per-kind hues (I L T S O Y W) — the default rainbow palette.
const CLASSIC_HUES = [195, 30, 280, 145, 50, 5, 320];

// A shaft theme bundles the two previously-separate styling concepts — the
// glyph dictionary (GlyphSetId) and the color palette (per-kind `hues`) —
// plus the tunnel-ring colors the shaft draws as slice borders. One enum
// tunable cycles whole looks, so themed variants are quick to preview.
export type ShaftTheme = {
  id: string;
  name: string;
  // Which role→glyph dictionary this theme draws with.
  glyph_set: GlyphSetId;
  // Per-kind piece hues (I L T S O Y W). A monochrome theme repeats one hue;
  // pieces then read apart by lightness + glyph rather than color.
  hues: number[];
  // Hue of the wall/obstacle family (low saturation, depth-shaded).
  wall_hue: number;
  // Bright near/far tunnel-ring color (the opening + floor edges).
  accent: string;
  // Faint interior slice-ring color (every other depth slice).
  ring: string;
};

export const SHAFT_THEMES: Record<string, ShaftTheme> = {
  classic: {
    id: "classic", name: "Classic", glyph_set: "blocks", hues: CLASSIC_HUES,
    wall_hue: 220, accent: "rgba(120,160,235,0.6)", ring: "rgba(96,130,210,0.22)",
  },
  shaded: {
    id: "shaded", name: "Shaded", glyph_set: "shaded", hues: CLASSIC_HUES,
    wall_hue: 220, accent: "rgba(120,160,235,0.6)", ring: "rgba(96,130,210,0.22)",
  },
  matrix: {
    id: "matrix", name: "Matrix", glyph_set: "retro", hues: new Array(7).fill(135),
    wall_hue: 135, accent: "rgba(90,240,140,0.55)", ring: "rgba(70,200,120,0.2)",
  },
  amber: {
    id: "amber", name: "Amber", glyph_set: "retro", hues: new Array(7).fill(38),
    wall_hue: 36, accent: "rgba(255,190,90,0.55)", ring: "rgba(220,150,70,0.2)",
  },
  ice: {
    id: "ice", name: "Ice", glyph_set: "blocks", hues: [200, 210, 190, 220, 205, 195, 215],
    wall_hue: 210, accent: "rgba(150,205,255,0.6)", ring: "rgba(120,170,230,0.22)",
  },
};

export type ShaftThemeId = keyof typeof SHAFT_THEMES & string;
export const DEFAULT_SHAFT_THEME: ShaftThemeId = "classic";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

function clampLight(v: number): number {
  return Math.round(v < 6 ? 6 : v > 96 ? 96 : v);
}

function blockColor(
  hue: number,
  depthT: number,
  lightDelta: number,
  bright: boolean,
  alpha = 1,
): string {
  const base = bright ? lerp(84, 52, depthT) : lerp(70, 30, depthT);
  const sat = bright ? 92 : 72;
  const a = alpha < 1 ? ` / ${alpha}` : "";
  return `hsl(${hue} ${sat}% ${clampLight(base + lightDelta)}%${a})`;
}

// Hue for kind `k` from a theme palette (or the classic rainbow when none).
function hueOf(hues: number[], k: number): number {
  return hues[k] ?? CLASSIC_HUES[k] ?? 210;
}

// The falling piece is drawn translucent in the stacked-slice views so a
// near cell doesn't fully hide the piece's own deeper cells (or settled
// cells in the same column) — just enough to read the 3D shape through it.
const PIECE_FG_ALPHA = 0.72;
const PIECE_BG_ALPHA = 0.42;

// The shaft ghost — a hollow wireframe of where the piece would hard-drop,
// drawn on the far (landing-depth) slices. Outline only (transparent
// interior), faint, so it reads as a target frame without occluding the
// stack behind it.
const GHOST_FG_ALPHA = 0.5;

function wallColor(depthT: number, lightDelta: number, hue = 220): string {
  return `hsl(${hue} 12% ${clampLight(lerp(52, 26, depthT) + lightDelta)}%)`;
}

function depthOf(z: number, H: number): number {
  return H <= 1 ? 0 : z / (H - 1);
}

function index(s: SubstrateState, x: number, y: number, z: number): number {
  return z * (s.W * s.D) + y * s.W + x;
}

type BlockSpec = {
  glyph: string; // glyph for ss = 1 (or the fill marker for ss > 1)
  shade: (delta: number) => string; // color by a lightness delta
  bold?: boolean;
  dim?: boolean;
};

// Paint one game cell into the buffer as an ssx×ssy block of characters
// (1×1 → a single glyph cell). The block is filled with the cell's own
// glyph (kept legible); the bevel + gutter only apply when the block is big
// enough to show them.
function drawBlock(
  surf: Surface,
  gx: number,
  gy: number,
  ssx: number,
  ssy: number,
  p: BlockSpec,
): void {
  if (ssx === 1 && ssy === 1) {
    put(surf, gx, gy, {
      glyph: p.glyph,
      fg: p.shade(0),
      ...(p.bold ? { bold: true } : {}),
      ...(p.dim ? { dim: true } : {}),
    });
    return;
  }
  const gutx = ssx >= 4 ? 1 : 0; // a 1-char gutter on the right/bottom edges
  const guty = ssy >= 3 ? 1 : 0;
  const bev = Math.min(ssx, ssy) >= 6 ? 1 : 0;
  const hi = p.shade(16);
  const base = p.shade(0);
  const lo = p.shade(-18);
  const spanx = ssx - gutx;
  const spany = ssy - guty;
  for (let sy = 0; sy < spany; sy++) {
    for (let sx = 0; sx < spanx; sx++) {
      let fg = base;
      if (sx < bev || sy < bev) fg = hi;
      else if (sx >= spanx - bev || sy >= spany - bev) fg = lo;
      put(surf, gx * ssx + sx, gy * ssy + sy, {
        glyph: p.glyph,
        fg,
        ...(p.dim ? { dim: true } : {}),
      });
    }
  }
}

// The well, top-down, at `ssx × ssy` characters per game cell. Order:
// background → stack surface (nearest cell per column) → landing shadow
// (uncovered columns) → falling piece (on top, bright).
export function buildWellSurface(
  s: SubstrateState,
  glyphs: GlyphSet<Role>,
  ssx: number,
  ssy: number,
): Surface {
  const fill =
    ssx === 1 && ssy === 1
      ? { glyph: rampGlyph(glyphs.empty, 0), fg: "#2b3140" }
      : { glyph: " " };
  const surf = makeSurface(s.W * ssx, s.D * ssy, fill);
  const covered: boolean[] = new Array(s.W * s.D).fill(false);

  for (let y = 0; y < s.D; y++) {
    for (let x = 0; x < s.W; x++) {
      for (let z = 0; z < s.H; z++) {
        const v = s.cells[index(s, x, y, z)] ?? 0;
        if (v === 0) continue;
        const t = depthOf(z, s.H);
        if (v === WALL) {
          drawBlock(surf, x, y, ssx, ssy, {
            glyph: rampGlyph(glyphs.wall, t),
            shade: (d) => wallColor(t, d),
          });
        } else {
          drawBlock(surf, x, y, ssx, ssy, {
            glyph: rampGlyph(glyphs.block, t),
            shade: (d) => blockColor(hueOf(CLASSIC_HUES, v - 1), t, d, false),
          });
        }
        covered[y * s.W + x] = true;
        break;
      }
    }
  }

  if (s.piece_kind >= 0 && s.outcome === "in_progress") {
    const cells = pieceCells(s.piece_kind, s.orient);

    const gz = landingZ(s, s.piece_kind, s.orient, s.piece_x, s.piece_y, s.piece_z);
    if (gz !== s.piece_z) {
      for (const c of cells) {
        const x = s.piece_x + c.x;
        const y = s.piece_y + c.y;
        if (x < 0 || y < 0 || x >= s.W || y >= s.D) continue;
        if (covered[y * s.W + x]) continue;
        drawBlock(surf, x, y, ssx, ssy, {
          glyph: rampGlyph(glyphs.shadow, 1),
          shade: (d) => blockColor(hueOf(CLASSIC_HUES, s.piece_kind), 1, d, false),
          dim: true,
        });
      }
    }

    const ordered = [...cells].sort((a, b) => b.z - a.z);
    for (const c of ordered) {
      const x = s.piece_x + c.x;
      const y = s.piece_y + c.y;
      const z = s.piece_z + c.z;
      if (z < 0 || x < 0 || y < 0 || x >= s.W || y >= s.D) continue;
      const t = depthOf(z, s.H);
      drawBlock(surf, x, y, ssx, ssy, {
        glyph: rampGlyph(glyphs.piece, t),
        shade: (d) => blockColor(hueOf(CLASSIC_HUES, s.piece_kind), t, d, true),
        bold: true,
      });
    }
  }

  return surf;
}

// One depth slice — the cross-section at z — for the stacked-<pre> 3D shaft
// lens. Filled cells are *opaque* (fg + bg) so they occlude the deeper
// slices stacked behind them; empty cells are spaces (no style) so the
// deeper slices show through. The 3D read comes from CSS-scaling these flat
// slices into a tunnel, not from any projection here.
export function buildSliceSurface(
  s: SubstrateState,
  z: number,
  theme: ShaftTheme,
  ssx: number,
  ssy: number,
): Surface {
  const glyphs = GLYPH_SETS[theme.glyph_set] ?? GLYPH_SETS.blocks!;
  const surf = makeSurface(s.W * ssx, s.D * ssy, { glyph: " " });
  const t = depthOf(z, s.H);

  const pieceHere = new Set<number>();
  // Cells of the hard-drop ghost that land on *this* slice (its landing base
  // is deeper than the live piece, so the ghost shows on far slices).
  const ghostHere = new Set<number>();
  if (s.piece_kind >= 0 && s.outcome === "in_progress") {
    const cells = pieceCells(s.piece_kind, s.orient);
    for (const c of cells) {
      if (s.piece_z + c.z !== z) continue;
      const x = s.piece_x + c.x;
      const y = s.piece_y + c.y;
      if (x >= 0 && y >= 0 && x < s.W && y < s.D) pieceHere.add(y * s.W + x);
    }
    const gz = landingZ(s, s.piece_kind, s.orient, s.piece_x, s.piece_y, s.piece_z);
    if (gz !== s.piece_z) {
      for (const c of cells) {
        if (gz + c.z !== z) continue;
        const x = s.piece_x + c.x;
        const y = s.piece_y + c.y;
        if (x >= 0 && y >= 0 && x < s.W && y < s.D) ghostHere.add(y * s.W + x);
      }
    }
  }

  for (let y = 0; y < s.D; y++) {
    for (let x = 0; x < s.W; x++) {
      let glyph: string;
      let fg: string;
      let bg: string;
      if (pieceHere.has(y * s.W + x)) {
        const ph = hueOf(theme.hues, s.piece_kind);
        glyph = rampGlyph(glyphs.piece, t);
        fg = blockColor(ph, t, 20, true, PIECE_FG_ALPHA);
        bg = blockColor(ph, t, -14, true, PIECE_BG_ALPHA);
      } else {
        const v = s.cells[index(s, x, y, z)] ?? 0;
        if (v === WALL) {
          glyph = rampGlyph(glyphs.wall, t);
          fg = wallColor(t, 14, theme.wall_hue);
          bg = wallColor(t, -14, theme.wall_hue);
        } else if (v !== 0) {
          const bh = hueOf(theme.hues, v - 1);
          glyph = rampGlyph(glyphs.block, t);
          fg = blockColor(bh, t, 14, false);
          bg = blockColor(bh, t, -16, false);
        } else if (ghostHere.has(y * s.W + x)) {
          // Empty cell that the piece will land in — draw the wireframe
          // outline only, leaving the interior transparent so the depth
          // behind it still reads.
          outlineSlice(surf, x, y, ssx, ssy, rampGlyph(glyphs.shadow, t),
            blockColor(hueOf(theme.hues, s.piece_kind), t, 18, true, GHOST_FG_ALPHA));
          continue;
        } else {
          continue; // empty → transparent, deeper slices show through
        }
      }
      fillSlice(surf, x, y, ssx, ssy, glyph, fg, bg);
    }
  }
  return surf;
}

// Fill one game cell of a slice with an opaque block of characters (a 1-char
// gutter on the right/bottom so adjacent cells read separately and deeper
// slices peek through the seams).
function fillSlice(
  surf: Surface,
  gx: number,
  gy: number,
  ssx: number,
  ssy: number,
  glyph: string,
  fg: string,
  bg: string,
): void {
  const gutx = ssx >= 4 ? 1 : 0;
  const guty = ssy >= 3 ? 1 : 0;
  for (let sy = 0; sy < ssy - guty; sy++) {
    for (let sx = 0; sx < ssx - gutx; sx++) {
      put(surf, gx * ssx + sx, gy * ssy + sy, { glyph, fg, bg });
    }
  }
}

// Draw only the perimeter of one game cell's character block (a hollow box) —
// the wireframe ghost. No bg, so the interior stays transparent and the
// deeper slices show through. Falls back to a full fill when the block is too
// small (1×1) to have a distinct border.
function outlineSlice(
  surf: Surface,
  gx: number,
  gy: number,
  ssx: number,
  ssy: number,
  glyph: string,
  fg: string,
): void {
  const gutx = ssx >= 4 ? 1 : 0;
  const guty = ssy >= 3 ? 1 : 0;
  const w = ssx - gutx;
  const h = ssy - guty;
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const edge = sx === 0 || sy === 0 || sx === w - 1 || sy === h - 1;
      if (!edge && w > 2 && h > 2) continue;
      put(surf, gx * ssx + sx, gy * ssy + sy, { glyph, fg });
    }
  }
}

// NEXT preview — the piece footprint at orient 0, top-down, as glyphs in a
// small box (kept readable; rendered to its own <pre>).
export function buildNextSurface(kind: number, glyphs: GlyphSet<Role>): Surface {
  if (kind < 0) return makeSurface(1, 1, { glyph: " " });
  const { ex, ey } = pieceExtent(kind, 0);
  const surf = makeSurface(ex, ey, { glyph: " " });
  const ordered = [...pieceCells(kind, 0)].sort((a, b) => b.z - a.z);
  for (const c of ordered) {
    const t = c.z / 2;
    put(surf, c.x, c.y, { glyph: rampGlyph(glyphs.piece, t), fg: blockColor(hueOf(CLASSIC_HUES, kind), t, 0, true), bold: true });
  }
  return surf;
}
