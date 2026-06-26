/* The raycaster — the lens's forward operator. A pure function of (camera pose,
 * world): no DOM, no canvas, fully testable. This is "a 3D renderer is a Lens
 * with a non-trivial forward operator" made literal — State → projected columns.
 *
 * Algorithm: textbook grid DDA (lodev.org/cgtutor/raycasting). One ray per
 * screen column, stepped cell-by-cell through the map until it hits a wall. We
 * report the *perpendicular* distance (not the euclidean ray length) so vertical
 * wall strips don't fisheye at the screen edges.
 */

import { tileAt, type TfpsConfig } from "../engine/config";

export type Column = {
  // Perpendicular distance to the wall, in map cells. Drives strip height.
  dist: number;
  // 0 = the ray crossed a N/S grid line (an x-facing wall face);
  // 1 = an E/W grid line. The lens shades the two differently for free relief.
  side: 0 | 1;
  // The wall kind that was hit (>0). The lens maps kind → color.
  tile: number;
};

const MAX_STEPS = 256; // a bordered map always hits well before this

// Cast a single ray from (px, py) along unit-ish direction (rdx, rdy). Returns
// the perpendicular hit distance, the side, and the wall kind. Shared by the
// per-column sweep and the bot's probe rays.
export function castRay(
  config: TfpsConfig,
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
    const t = tileAt(config, mapX + 0.5, mapY + 0.5);
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
  return { dist, side, tile };
}

// Sweep `numColumns` rays across the camera's FOV. `planeMag` is the projection
// plane half-width relative to the unit view direction (tan(fov/2)); the lens
// derives it from its canvas aspect so the projection is undistorted.
export function castColumns(
  config: TfpsConfig,
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
    const rdx = dirX + planeX * cameraX;
    const rdy = dirY + planeY * cameraX;
    cols[x] = castRay(config, px, py, rdx, rdy);
  }
  return cols;
}
