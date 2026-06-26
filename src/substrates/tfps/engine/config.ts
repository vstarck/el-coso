/* tfps level config (parsed shape). The map is a flat row-major grid of wall
 * kinds: 0 = empty (floor), >0 = a wall kind (the lens maps kinds to colors).
 * `mapW * mapH === map.length`. Spawn pose + locomotion rates are authored per
 * level. FOV is NOT authored — the lens derives an undistorted projection plane
 * from its own canvas aspect, so the level only owns the world + the walker.
 */
export type TfpsConfig = {
  id: string;
  map: number[];
  mapW: number;
  mapH: number;
  spawnX: number;
  spawnY: number;
  spawnAngle: number; // radians
  moveSpeed: number; // cells per tick
  turnSpeed: number; // radians per tick
};

// Wall test: out-of-bounds counts as wall, so a level with a solid border can
// never let the camera escape the grid.
export function isWall(config: TfpsConfig, x: number, y: number): boolean {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || my < 0 || mx >= config.mapW || my >= config.mapH) return true;
  return (config.map[my * config.mapW + mx] ?? 0) !== 0;
}

// Wall kind at a cell (0 if empty / out of bounds). The raycaster reports this
// for the column so the lens can color by kind.
export function tileAt(config: TfpsConfig, x: number, y: number): number {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  if (mx < 0 || my < 0 || mx >= config.mapW || my >= config.mapH) return 1;
  return config.map[my * config.mapW + mx] ?? 0;
}
