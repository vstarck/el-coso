// The twelve free pentominoes, each named after the letter it resembles —
// the letter IS the shape's canonical name, which is why the commit glyph
// can be a char and still be "the piece icon". Cells are (x, y) with y
// down, normalized so min x = min y = 0.
//
// Rotation is computed, not tabled: a quarter-turn clockwise maps
// (x, y) → (-y, x), then the set re-normalizes to the origin. Pure and
// deterministic, so replay and the Godot port get the same shapes.

export type Cell = { x: number; y: number };

export const PIECE_NAMES: string[] = [
  "F",
  "I",
  "L",
  "N",
  "P",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
];

export const PENTOMINOES: Cell[][] = [
  // F
  [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
  ],
  // I (horizontal so the spawn footprint is shallow)
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 4, y: 0 },
  ],
  // L
  [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 0, y: 3 },
    { x: 1, y: 3 },
  ],
  // N
  [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 3 },
  ],
  // P
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 2 },
  ],
  // T
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
  ],
  // U
  [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ],
  // V
  [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ],
  // W
  [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ],
  // X
  [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
  ],
  // Y
  [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 1, y: 3 },
  ],
  // Z
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ],
];

function rotateOnce(cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  let min_x = Infinity;
  let min_y = Infinity;
  for (const c of cells) {
    const nx = -c.y;
    const ny = c.x;
    if (nx < min_x) min_x = nx;
    if (ny < min_y) min_y = ny;
    out.push({ x: nx, y: ny });
  }
  for (const c of out) {
    c.x -= min_x;
    c.y -= min_y;
  }
  return out;
}

// The rotated, origin-normalized cell set for (kind, rot). rot counts
// quarter-turns clockwise; any integer is accepted.
export function pieceCells(kind: number, rot: number): Cell[] {
  let cells = PENTOMINOES[kind] ?? [];
  const r = ((rot % 4) + 4) % 4;
  for (let i = 0; i < r; i++) cells = rotateOnce(cells);
  return cells;
}

// Bounding-box width of the rotated shape — used to center the spawn.
export function pieceWidth(kind: number, rot: number): number {
  let max_x = 0;
  for (const c of pieceCells(kind, rot)) if (c.x > max_x) max_x = c.x;
  return max_x + 1;
}
