/* tts view projection. The lens is "just a JSON view of the state", so the
 * substrate is projected to a plain object whose `board` field is an array
 * of equal-length row strings — one glyph per cell, respecting columns and
 * rows. Pieces are told apart by their letter glyph (not color); the whole
 * readout renders in a single themable color. */

import type { SubstrateState } from "../engine";
import { PIECE_NAMES, pieceCells } from "../engine";

const EMPTY = ".";

// One glyph per board cell: a settled cell shows the letter of the piece
// that locked there, the falling piece overlays its own letter, empty cells
// are '.'. Returns one string per row.
export function boardRows(s: SubstrateState): string[] {
  const W = s.W;
  const H = s.H;
  const grid: string[][] = [];
  for (let y = 0; y < H; y++) {
    const row: string[] = [];
    for (let x = 0; x < W; x++) {
      const v = s.cells[y * W + x] ?? 0;
      row.push(v === 0 ? EMPTY : PIECE_NAMES[v - 1] ?? "?");
    }
    grid.push(row);
  }
  // Overlay the live piece (only while the run is in progress — once topped
  // out, the board shows just what locked).
  if (s.piece_kind >= 0 && s.outcome === "in_progress") {
    const glyph = PIECE_NAMES[s.piece_kind] ?? "?";
    for (const c of pieceCells(s.piece_kind, s.piece_rot)) {
      const x = s.piece_x + c.x;
      const y = s.piece_y + c.y;
      if (y >= 0 && y < H && x >= 0 && x < W) grid[y]![x] = glyph;
    }
  }
  return grid.map((r) => r.join(""));
}

// Lens-level flags the commands drive. They live outside the substrate state
// (they're view/control, not physics), so the lens passes them in — command
// effects surface here, in the readout itself, rather than as side output.
export type LensFlags = {
  auto: boolean; // self-play (the `auto` command)
  paused: boolean; // loop stopped (the `pause` / `play` commands)
};

export type TtsView = {
  tick: number;
  auto: boolean;
  status: string;
  lines: number;
  piece: string;
  next: string;
  board: string[];
};

export function stateView(
  s: SubstrateState,
  flags: LensFlags = { auto: false, paused: false },
): TtsView {
  // The run state folds the pause flag in — a deliberate `pause` reads as
  // "paused", while a finished run keeps its terminal word (the loop stops
  // on game-over too, but that's "topped out", not "paused").
  const status =
    s.outcome === "lost"
      ? "topped out"
      : s.outcome === "won"
        ? "cleared"
        : flags.paused
          ? "paused"
          : "playing";
  return {
    tick: s.tick,
    auto: flags.auto,
    status,
    lines: s.lines,
    piece: s.piece_kind >= 0 ? PIECE_NAMES[s.piece_kind] ?? "?" : "-",
    next: s.next_kind >= 0 ? PIECE_NAMES[s.next_kind] ?? "?" : "-",
    board: boardRows(s),
  };
}

// The terminal readout: the state view, pretty-printed. The board's row
// strings line their columns up under 2-space indentation, which is exactly
// the grid the player reads.
export function renderJson(s: SubstrateState, flags?: LensFlags): string {
  return JSON.stringify(stateView(s, flags), null, 2);
}
