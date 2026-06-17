// The polycube set — seven distinct tetracubes (4-cell 3D pieces), each
// named after the letter / shape it resembles. Five are planar (I, L, T,
// S, O — the familiar tetrominoes) and two are genuinely three-
// dimensional (Y the corner tripod, W the screw).
//
// Orientations are precomputed, not re-derived per tick. Each kind ships
// its deduped orientation set (≤24) plus a transition table
// rot[axis][orient] → orient', so State stores a small integer `orient`
// (hashable, replay-safe) and a rotation is a table lookup. Generation is
// pure (BFS from the base cell-set under the three 90° axis-rotations,
// canonical-keyed dedup), so replay and a Godot port get identical shapes.

export type Cell3 = { x: number; y: number; z: number };

export const PIECE_NAMES: string[] = ["I", "L", "T", "S", "O", "Y", "W"];

// Base cell-sets. x/y span the well cross-section, z is depth.
const BASE: Cell3[][] = [
  // I — a 1×1×4 bar
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
  ],
  // L
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
  ],
  // T
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
  // S (skew)
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 2, y: 1, z: 0 },
  ],
  // O — a 2×2 square
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ],
  // Y — corner tripod: three orthogonal arms from one cube (truly 3D)
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  // W — screw: an L in the x-y plane with the end lifted in z (truly 3D)
  [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 1, z: 1 },
  ],
];

export type Axis = "x" | "y" | "z";

// 90° rotations (right-handed). Each maps a coordinate, then the set
// re-normalizes to the origin.
function rot1(c: Cell3, axis: Axis): Cell3 {
  if (axis === "x") return { x: c.x, y: -c.z, z: c.y };
  if (axis === "y") return { x: c.z, y: c.y, z: -c.x };
  return { x: -c.y, y: c.x, z: c.z }; // z
}

function normalize(cells: Cell3[]): Cell3[] {
  let mx = Infinity;
  let my = Infinity;
  let mz = Infinity;
  for (const c of cells) {
    if (c.x < mx) mx = c.x;
    if (c.y < my) my = c.y;
    if (c.z < mz) mz = c.z;
  }
  return cells.map((c) => ({ x: c.x - mx, y: c.y - my, z: c.z - mz }));
}

function rotateCells(cells: Cell3[], axis: Axis): Cell3[] {
  return normalize(cells.map((c) => rot1(c, axis)));
}

// Order-independent identity of a normalized cell-set.
function canonicalKey(cells: Cell3[]): string {
  return cells
    .map((c) => `${c.x},${c.y},${c.z}`)
    .sort()
    .join("|");
}

type PieceOrients = {
  orientations: Cell3[][];
  transitions: Record<Axis, number[]>;
};

function genOrientations(base: Cell3[]): PieceOrients {
  const start = normalize(base);
  const orientations: Cell3[][] = [start];
  const keyToIndex: Record<string, number> = { [canonicalKey(start)]: 0 };
  const queue: number[] = [0];
  while (queue.length > 0) {
    const i = queue.shift()!;
    for (const axis of ["x", "y", "z"] as Axis[]) {
      const r = rotateCells(orientations[i]!, axis);
      const k = canonicalKey(r);
      if (!(k in keyToIndex)) {
        keyToIndex[k] = orientations.length;
        orientations.push(r);
        queue.push(keyToIndex[k]!);
      }
    }
  }
  const transitions: Record<Axis, number[]> = { x: [], y: [], z: [] };
  for (let i = 0; i < orientations.length; i++) {
    for (const axis of ["x", "y", "z"] as Axis[]) {
      const r = rotateCells(orientations[i]!, axis);
      transitions[axis][i] = keyToIndex[canonicalKey(r)]!;
    }
  }
  return { orientations, transitions };
}

const ORIENTS: PieceOrients[] = BASE.map(genOrientations);

// The cell-set for (kind, orient), normalized to the origin. `orient` is
// taken modulo the kind's orientation count, so any integer is accepted.
export function pieceCells(kind: number, orient: number): Cell3[] {
  const p = ORIENTS[kind];
  if (!p) return [];
  const n = p.orientations.length;
  const o = ((orient % n) + n) % n;
  return p.orientations[o]!;
}

// The orientation index reached by rotating (kind, orient) +90° about
// `axis`. A pure table lookup.
export function rotateOrient(kind: number, orient: number, axis: Axis): number {
  const p = ORIENTS[kind];
  if (!p) return orient;
  const n = p.orientations.length;
  const o = ((orient % n) + n) % n;
  return p.transitions[axis][o] ?? o;
}

export function orientCount(kind: number): number {
  return ORIENTS[kind]?.orientations.length ?? 1;
}

// Bounding-box extents of (kind, orient) — used to center the spawn.
export function pieceExtent(
  kind: number,
  orient: number,
): { ex: number; ey: number; ez: number } {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  for (const c of pieceCells(kind, orient)) {
    if (c.x > ex) ex = c.x;
    if (c.y > ey) ey = c.y;
    if (c.z > ez) ez = c.z;
  }
  return { ex: ex + 1, ey: ey + 1, ez: ez + 1 };
}
