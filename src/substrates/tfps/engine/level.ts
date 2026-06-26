import type { TfpsConfig } from "./config";

/* Authoring-flat level JSON → runtime config.
 *
 * The map is authored as an array of equal-length strings (one row each), which
 * reads like the level looks:
 *
 *   "map": [
 *     "########",
 *     "#..#...#",
 *     "#......#",
 *     "########"
 *   ]
 *
 * Glyphs: `#` and digits `1`–`9` are wall kinds (the digit IS the kind; `#` = 1);
 * `.` and space are empty floor. Spawn angle is authored in DEGREES (0 = east,
 * 90 = south) for legibility; stored as radians.
 */
export type LevelFile = {
  id: string;
  map?: string[];
  spawn?: { x?: number; y?: number; angle?: number };
  move_speed?: number;
  turn_speed?: number;
};

const DEG = Math.PI / 180;

function glyphToKind(ch: string): number {
  if (ch === "#") return 1;
  if (ch >= "1" && ch <= "9") return ch.charCodeAt(0) - "0".charCodeAt(0);
  return 0; // '.', ' ', anything else = empty
}

// A tiny fallback box so a malformed level still mounts (never a blank crash):
// a 4×4 room the camera spawns in the middle of.
const FALLBACK_MAP = ["####", "#..#", "#..#", "####"];

export function parseLevel(json: unknown): TfpsConfig {
  const o = (json ?? {}) as LevelFile;
  const rows =
    Array.isArray(o.map) && o.map.length > 0 ? o.map : FALLBACK_MAP;
  const mapH = rows.length;
  const mapW = Math.max(...rows.map((r) => r.length));

  const map: number[] = new Array(mapW * mapH).fill(0);
  for (let y = 0; y < mapH; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < mapW; x++) {
      map[y * mapW + x] = glyphToKind(row[x] ?? " ");
    }
  }

  const spawn = o.spawn ?? {};
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    map,
    mapW,
    mapH,
    spawnX: typeof spawn.x === "number" ? spawn.x : 1.5,
    spawnY: typeof spawn.y === "number" ? spawn.y : 1.5,
    spawnAngle: (typeof spawn.angle === "number" ? spawn.angle : 0) * DEG,
    moveSpeed: typeof o.move_speed === "number" ? o.move_speed : 0.045,
    turnSpeed: typeof o.turn_speed === "number" ? o.turn_speed : 0.035,
  };
}
