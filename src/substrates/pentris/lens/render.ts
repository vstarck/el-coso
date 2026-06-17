// Pentris draw + serialize helpers (chrome-tier). Column B's board painter,
// the NEXT-piece mini, and column A's dev-tool digest all live here so the
// mount file stays wiring.

import type { PentrisConfig, SubstrateState } from "../engine";
import { PENTOMINOES, PIECE_NAMES, hashState, pieceCells, collides } from "../engine";

// --- Palettes -------------------------------------------------------------

export type PaletteId = "vivid" | "geometry";

// Hand-picked, one color per pentomino, indexed by kind.
const VIVID_COLORS: string[] = [
  "#f472b6", // F
  "#38bdf8", // I
  "#fb923c", // L
  "#a78bfa", // N
  "#facc15", // P
  "#34d399", // T
  "#f87171", // U
  "#60a5fa", // V
  "#fbbf24", // W
  "#e879f9", // X
  "#4ade80", // Y
  "#22d3ee", // Z
];

// Authored-by-math: each piece's color is computed from its own cell
// configuration. Hue comes from the principal-axis angle of the cell
// cloud (nudged by the centroid so symmetric ties separate), saturation
// from elongation (I is the most stretched, X the roundest), lightness
// inverse to it. No table to maintain — add a 13th piece and it arrives
// pre-colored.
const GEOMETRY_COLORS: string[] = PENTOMINOES.map((cells) => {
  const n = cells.length;
  let mx = 0;
  let my = 0;
  for (const c of cells) {
    mx += c.x / n;
    my += c.y / n;
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const c of cells) {
    sxx += ((c.x - mx) * (c.x - mx)) / n;
    syy += ((c.y - my) * (c.y - my)) / n;
    sxy += ((c.x - mx) * (c.y - my)) / n;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  const ecc = l1 > 0 ? 1 - l2 / l1 : 0; // 0 round … 1 line
  const hue =
    (((theta + Math.PI / 2) / Math.PI) * 300 + ecc * 120 + mx * 47 + my * 89) % 360;
  const sat = Math.round(35 + 55 * ecc);
  const light = Math.round(50 + 18 * (1 - ecc));
  return `hsl(${Math.round(hue)} ${sat}% ${light}%)`;
});

export function pieceColor(kind: number, palette: PaletteId): string {
  const table = palette === "geometry" ? GEOMETRY_COLORS : VIVID_COLORS;
  return table[kind] ?? "#94a3b8";
}

// --- Column B: the well ----------------------------------------------------

export type BoardDrawOpts = {
  cell_px: number;
  show_ghost: boolean;
  palette: PaletteId;
};

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  s: SubstrateState,
  o: BoardDrawOpts,
): void {
  const cp = o.cell_px;
  const w_px = s.W * cp;
  const h_px = s.H * cp;

  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, w_px, h_px);

  // Grid.
  ctx.strokeStyle = "rgba(148,163,184,0.07)";
  ctx.lineWidth = 1;
  for (let x = 1; x < s.W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cp + 0.5, 0);
    ctx.lineTo(x * cp + 0.5, h_px);
    ctx.stroke();
  }
  for (let y = 1; y < s.H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cp + 0.5);
    ctx.lineTo(w_px, y * cp + 0.5);
    ctx.stroke();
  }

  // Settled stack, colored by the piece that built each cell.
  for (let y = 0; y < s.H; y++) {
    for (let x = 0; x < s.W; x++) {
      const v = s.cells[y * s.W + x] ?? 0;
      if (v === 0) continue;
      ctx.fillStyle = pieceColor(v - 1, o.palette);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x * cp + 1, y * cp + 1, cp - 2, cp - 2);
    }
  }
  ctx.globalAlpha = 1;

  if (s.piece_kind >= 0) {
    const cells = pieceCells(s.piece_kind, s.piece_rot);

    // Ghost — where a hard drop would land.
    if (o.show_ghost && s.outcome === "in_progress") {
      let gy = s.piece_y;
      while (!collides(s, s.piece_kind, s.piece_rot, s.piece_x, gy + 1)) gy++;
      if (gy !== s.piece_y) {
        ctx.strokeStyle = pieceColor(s.piece_kind, o.palette);
        ctx.globalAlpha = 0.35;
        for (const c of cells) {
          const y = gy + c.y;
          if (y < 0) continue;
          ctx.strokeRect((s.piece_x + c.x) * cp + 1.5, y * cp + 1.5, cp - 3, cp - 3);
        }
        ctx.globalAlpha = 1;
      }
    }

    // The falling piece.
    ctx.fillStyle = pieceColor(s.piece_kind, o.palette);
    for (const c of cells) {
      const y = s.piece_y + c.y;
      if (y < 0) continue;
      ctx.fillRect((s.piece_x + c.x) * cp + 1, y * cp + 1, cp - 2, cp - 2);
    }
  }

  // Terminal wash.
  if (s.outcome !== "in_progress") {
    ctx.fillStyle =
      s.outcome === "won" ? "rgba(52,211,153,0.18)" : "rgba(248,113,113,0.18)";
    ctx.fillRect(0, 0, w_px, h_px);
  }
}

// NEXT-piece preview, centered in a square mini-canvas.
export function drawMiniPiece(
  ctx: CanvasRenderingContext2D,
  kind: number,
  box_px: number,
  palette: PaletteId,
): void {
  ctx.clearRect(0, 0, box_px, box_px);
  if (kind < 0) return;
  const cells = pieceCells(kind, 0);
  let max_x = 0;
  let max_y = 0;
  for (const c of cells) {
    if (c.x > max_x) max_x = c.x;
    if (c.y > max_y) max_y = c.y;
  }
  const cp = Math.floor(box_px / Math.max(max_x + 1, max_y + 1, 3));
  const ox = Math.floor((box_px - (max_x + 1) * cp) / 2);
  const oy = Math.floor((box_px - (max_y + 1) * cp) / 2);
  ctx.fillStyle = pieceColor(kind, palette);
  for (const c of cells) {
    ctx.fillRect(ox + c.x * cp + 1, oy + c.y * cp + 1, cp - 2, cp - 2);
  }
}

// --- Column A: the dev-tool digest ------------------------------------------

// The substrate state, made literal. Settled cells print as the lower-case
// letter of the piece that built them; the falling piece overlays in
// upper-case. Scalars stay one line each (the piece pose collapses to a
// compact string) so the whole digest fits the panel without scrolling on
// a normal viewport.
export function boardDigest(s: SubstrateState, config: PentrisConfig): string {
  const rows: string[] = [];
  for (let y = 0; y < s.H; y++) {
    let row = "";
    for (let x = 0; x < s.W; x++) {
      const v = s.cells[y * s.W + x] ?? 0;
      row += v === 0 ? "·" : (PIECE_NAMES[v - 1] ?? "?").toLowerCase();
    }
    rows.push(row);
  }
  if (s.piece_kind >= 0) {
    const letter = PIECE_NAMES[s.piece_kind] ?? "?";
    for (const c of pieceCells(s.piece_kind, s.piece_rot)) {
      const y = s.piece_y + c.y;
      const x = s.piece_x + c.x;
      if (y < 0 || y >= s.H || x < 0 || x >= s.W) continue;
      const row = rows[y] ?? "";
      rows[y] = row.slice(0, x) + letter + row.slice(x + 1);
    }
  }
  const piece =
    s.piece_kind >= 0
      ? `${PIECE_NAMES[s.piece_kind] ?? "?"} r${s.piece_rot} @ ${s.piece_x},${s.piece_y}`
      : null;
  const digest = {
    tick: s.tick,
    outcome: s.outcome,
    hash: hashState(s),
    piece,
    next: PIECE_NAMES[s.next_kind] ?? null,
    lines: s.lines,
    win_lines: config.win_lines,
    spawn_count: s.spawn_count,
    drop_acc: s.drop_acc,
    move_cooldown: s.move_cooldown,
    board: rows,
  };
  return JSON.stringify(digest, null, 2);
}
