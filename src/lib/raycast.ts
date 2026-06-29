/* ASCII raycaster kit — a pure grid DDA raycaster (the host-agnostic core of a
 * "3D renderer is a Lens with a non-trivial forward operator"). No DOM, no
 * canvas, fully testable: a camera pose + a wall grid → one perpendicular hit per
 * screen column. First extracted from tfps (S113); shared the moment a second
 * consumer appeared (nm5, S114) — the renderer is generic, the *tonemap* on top
 * (glyph ramp, shading, corruption) stays substrate-side.
 *
 * Algorithm: textbook grid DDA (lodev.org/cgtutor/raycasting). One ray per
 * column, stepped cell-by-cell to the first wall; the *perpendicular* distance
 * (not euclidean ray length) drives the wall-strip height so edges don't fisheye.
 */

// The minimal world the raycaster needs: dimensions + a row-major wall grid where
// 0 = floor (the ray passes) and >0 = a wall kind (the ray stops). Any config
// with these three fields satisfies it structurally — no adapter needed.
export type GridMap = {
  mapW: number;
  mapH: number;
  map: ArrayLike<number>; // row-major, length mapW*mapH; 0 = floor, >0 = wall kind
};

export type Column = {
  // Perpendicular distance to the wall, in map cells. Drives strip height.
  dist: number;
  // 0 = the ray crossed a N/S grid line (an x-facing wall face);
  // 1 = an E/W grid line. Consumers shade the two differently for free relief.
  side: 0 | 1;
  // The wall kind that was hit (>0). Consumers map kind → colour.
  tile: number;
  // The wall CELL that was hit (integer map coords). Lets a consumer look up
  // per-cell data at the hit — e.g. nm5's corruption field at that wall.
  cx: number;
  cy: number;
};

const MAX_STEPS = 256; // a bordered map always hits well before this

// Wall kind at a cell; out-of-bounds counts as wall kind 1 (a bordered map can't
// leak a ray to infinity).
function tileAt(g: GridMap, x: number, y: number): number {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || my < 0 || mx >= g.mapW || my >= g.mapH) return 1;
  return g.map[my * g.mapW + mx] ?? 0;
}

// Cast a single ray from (px, py) along direction (rdx, rdy). Returns the
// perpendicular hit distance, side, wall kind, and the hit cell. Shared by the
// per-column sweep and any probe rays a consumer's bot casts.
export function castRay(
  g: GridMap,
  px: number,
  py: number,
  rdx: number,
  rdy: number,
): Column {
  let mapX = Math.floor(px);
  let mapY = Math.floor(py);

  const deltaX = rdx === 0 ? Infinity : Math.abs(1 / rdx);
  const deltaY = rdy === 0 ? Infinity : Math.abs(1 / rdy);

  let stepX: number;
  let stepY: number;
  let sideDistX: number;
  let sideDistY: number;

  if (rdx < 0) {
    stepX = -1;
    sideDistX = (px - mapX) * deltaX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - px) * deltaX;
  }
  if (rdy < 0) {
    stepY = -1;
    sideDistY = (py - mapY) * deltaY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - py) * deltaY;
  }

  let side: 0 | 1 = 0;
  let tile = 1;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaY;
      mapY += stepY;
      side = 1;
    }
    const t = tileAt(g, mapX + 0.5, mapY + 0.5);
    if (t !== 0) {
      tile = t;
      break;
    }
  }

  // Perpendicular distance: back off one delta from the accumulated sideDist.
  const dist =
    side === 0
      ? Math.max(1e-4, sideDistX - deltaX)
      : Math.max(1e-4, sideDistY - deltaY);
  return { dist, side, tile, cx: mapX, cy: mapY };
}

// Sweep `numColumns` rays across the camera's FOV. `planeMag` is the projection
// plane half-width relative to the unit view direction (tan(fov/2)); the consumer
// derives it from its canvas aspect so the projection is undistorted.
export function castColumns(
  g: GridMap,
  px: number,
  py: number,
  angle: number,
  planeMag: number,
  numColumns: number,
): Column[] {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const planeX = -dirY * planeMag;
  const planeY = dirX * planeMag;

  const cols: Column[] = new Array(numColumns);
  for (let x = 0; x < numColumns; x++) {
    const cameraX = (2 * x) / numColumns - 1;
    cols[x] = castRay(g, px, py, dirX + planeX * cameraX, dirY + planeY * cameraX);
  }
  return cols;
}
