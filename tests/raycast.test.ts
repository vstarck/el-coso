import { describe, it, expect } from "vitest";
import { castRay, castColumns, type GridMap } from "@/lib/raycast";

// A 5×5 walled box; floor interior. `map` row-major, 1 = wall, 0 = floor.
const BOX: GridMap = {
  mapW: 5,
  mapH: 5,
  map: [
    1, 1, 1, 1, 1,
    1, 0, 0, 0, 1,
    1, 0, 0, 0, 1,
    1, 0, 0, 0, 1,
    1, 1, 1, 1, 1,
  ],
};

describe("lib/raycast", () => {
  it("perpendicular distance + hit cell straight ahead", () => {
    // From centre (2.5) east to the wall face at x=4 → 1.5 cells; hit cell (4,2).
    const col = castRay(BOX, 2.5, 2.5, 1, 0);
    expect(col.dist).toBeCloseTo(1.5, 5);
    expect(col.side).toBe(0);
    expect(col.tile).toBeGreaterThan(0);
    expect(col.cx).toBe(4);
    expect(col.cy).toBe(2);
  });

  it("reports the hit cell for a ray fired north (−y)", () => {
    const col = castRay(BOX, 2.5, 2.5, 0, -1);
    expect(col.cx).toBe(2);
    expect(col.cy).toBe(0); // top wall row
    expect(col.side).toBe(1); // crossed an E/W grid line
  });

  it("every column hits, finite, with an in-bounds-or-border hit cell", () => {
    const cols = castColumns(BOX, 2.5, 2.5, 0, 0.66, 64);
    expect(cols).toHaveLength(64);
    for (const c of cols) {
      expect(Number.isFinite(c.dist)).toBe(true);
      expect(c.dist).toBeGreaterThan(0);
      expect(c.tile).toBeGreaterThan(0);
      expect(Number.isInteger(c.cx)).toBe(true);
      expect(Number.isInteger(c.cy)).toBe(true);
    }
  });

  it("accepts a typed-array map (structural GridMap)", () => {
    const g: GridMap = { mapW: BOX.mapW, mapH: BOX.mapH, map: Uint8Array.from(BOX.map) };
    expect(castRay(g, 2.5, 2.5, 1, 0).dist).toBeCloseTo(1.5, 5);
  });
});
