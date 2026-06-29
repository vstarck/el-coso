import { describe, it, expect } from "vitest";
import { runHeadless } from "@/engine/headless";
import {
  tfpsBundle,
  parseLevel,
  isWall,
  type TfpsConfig,
  type TfpsInputs,
} from "@/substrates/tfps";
import { castRay, castColumns } from "@/lib/raycast";
import { allocSubstrate, swap, tick } from "@/substrates/tfps";
import { botInputs } from "@/substrates/tfps/lens/bot";
import { makeViewSurface, paintMinimap } from "@/substrates/tfps/lens/render";
import { resolveTheme } from "@/substrates/tfps/lens/theme";
import e1m1 from "@/substrates/tfps/puzzles/e1m1.json";

const NONE: TfpsInputs = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
};
function held(over: Partial<TfpsInputs>, n: number): TfpsInputs[] {
  return Array.from({ length: n }, () => ({ ...NONE, ...over }));
}

// A 5×5 walled box; camera spawns at the center facing east (+x).
const BOX: TfpsConfig = parseLevel({
  id: "box",
  map: ["#####", "#...#", "#...#", "#...#", "#####"],
  spawn: { x: 2.5, y: 2.5, angle: 0 },
  move_speed: 0.05,
  turn_speed: 0.04,
});

describe("tfps engine", () => {
  it("parses the level: dims, border walls, open interior", () => {
    expect(BOX.mapW).toBe(5);
    expect(BOX.mapH).toBe(5);
    expect(isWall(BOX, 0, 0)).toBe(true); // corner
    expect(isWall(BOX, 2.5, 2.5)).toBe(false); // spawn cell
    expect(isWall(BOX, 4.5, 2.5)).toBe(true); // east wall
    expect(isWall(BOX, -1, 2)).toBe(true); // out of bounds = wall
  });

  it("moving forward advances along the facing", () => {
    const s = runHeadless(tfpsBundle, BOX, 1, held({ forward: true }, 5));
    expect(s.px).toBeCloseTo(2.5 + 5 * 0.05, 6); // due east, no turn
    expect(s.py).toBeCloseTo(2.5, 6);
    expect(s.tick).toBe(5);
  });

  it("walls stop movement — the camera never escapes the box", () => {
    const s = runHeadless(tfpsBundle, BOX, 1, held({ forward: true }, 200));
    expect(s.px).toBeGreaterThan(2.5); // it did move
    expect(s.px).toBeLessThan(4); // but not through the east wall
    // Pushing further does not gain any ground.
    const more = runHeadless(tfpsBundle, BOX, 1, held({ forward: true }, 400));
    expect(more.px).toBeCloseTo(s.px, 6);
  });

  it("turning changes the heading, not the position", () => {
    const s = runHeadless(tfpsBundle, BOX, 1, held({ turnRight: true }, 10));
    expect(s.angle).toBeCloseTo(10 * 0.04, 6);
    expect(s.px).toBeCloseTo(2.5, 6);
    expect(s.py).toBeCloseTo(2.5, 6);
  });

  it("is deterministic: same (config, seed, inputs) → identical state", () => {
    const inputs = [
      ...held({ forward: true }, 30),
      ...held({ turnRight: true }, 20),
      ...held({ forward: true, strafeLeft: true }, 30),
    ];
    const a = runHeadless(tfpsBundle, BOX, 7, inputs);
    const b = runHeadless(tfpsBundle, BOX, 7, inputs);
    expect(a).toEqual(b);
  });
});

describe("tfps raycaster", () => {
  it("perpendicular distance to a wall straight ahead", () => {
    // From center (2.5) east to the wall face at x=4 → 1.5 cells.
    const col = castRay(BOX, 2.5, 2.5, 1, 0);
    expect(col.dist).toBeCloseTo(1.5, 5);
    expect(col.side).toBe(0); // crossed an x grid line (N/S face)
    expect(col.tile).toBeGreaterThan(0);
  });

  it("nearer wall → smaller distance (monotonic with position)", () => {
    const far = castRay(BOX, 1.5, 2.5, 1, 0).dist;
    const near = castRay(BOX, 3.5, 2.5, 1, 0).dist;
    expect(near).toBeLessThan(far);
  });

  it("every column hits a wall in a closed box (finite, no fisheye blowup)", () => {
    const cols = castColumns(BOX, 2.5, 2.5, 0, 0.66, 120);
    expect(cols).toHaveLength(120);
    for (const c of cols) {
      expect(Number.isFinite(c.dist)).toBe(true);
      expect(c.dist).toBeGreaterThan(0);
      expect(c.tile).toBeGreaterThan(0);
    }
  });
});

describe("tfps self-play bot", () => {
  it("wanders the real level without ever clipping into a wall", () => {
    const cfg = parseLevel(e1m1);
    const sub = allocSubstrate(cfg);
    let rng = { seed: 1 };
    const visited = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      const input = botInputs(cfg, sub.read);
      rng = tick(sub, cfg, rng, input);
      swap(sub);
      const s = sub.read;
      // Collision integrity: the bot's pose is always on a floor cell.
      expect(isWall(cfg, s.px, s.py)).toBe(false);
      visited.add(`${Math.floor(s.px)},${Math.floor(s.py)}`);
    }
    // It actually explored — not stuck spinning in the spawn cell.
    expect(visited.size).toBeGreaterThan(5);
  });
});

describe("tfps minimap HUD", () => {
  it("draws a framed 20×20 panel with the player arrow dead-center", () => {
    const cfg = parseLevel(e1m1);
    const s = makeViewSurface({ cols: 120, rows: 45 });
    const size = 20;
    const ox = s.w - size;
    paintMinimap(s, {
      config: cfg,
      px: cfg.spawnX,
      py: cfg.spawnY,
      angle: 0, // facing east
      theme: resolveTheme("neon"),
    });
    const at = (x: number, y: number) => s.cells[y * s.w + x]!;
    // Frame corners.
    expect(at(ox, 0).glyph).toBe("┌");
    expect(at(ox + size - 1, 0).glyph).toBe("┐");
    expect(at(ox + size - 1, size - 1).glyph).toBe("┘");
    // Player marker at the interior center: facing east → "→".
    const half = Math.floor((size - 2) / 2);
    expect(at(ox + 1 + half, 1 + half).glyph).toBe("→");
  });
});
