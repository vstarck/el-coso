import type { RNGState } from "@/engine/types";
import type { ConwayConfig } from "./config";
import type { ConwayInputs, SubstrateState } from "./types";

// B3/S23 with per-axis boundary handling. RNG-free; threaded through but
// returned unchanged.
export function tickConway(
  r: SubstrateState,
  w: SubstrateState,
  config: ConwayConfig,
  rng: RNGState,
  _inputs: ConwayInputs,
): RNGState {
  // (0) Carry scalars forward.
  w.W = r.W;
  w.H = r.H;
  w.tick = r.tick + 1;

  const W = r.W;
  const H = r.H;
  const wrap_x = config.boundary_x === "wrap";
  const wrap_y = config.boundary_y === "wrap";
  const rcells = r.cells;
  const wcells = w.cells;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = neighborIndex(x + dx, W, wrap_x);
          const ny = neighborIndex(y + dy, H, wrap_y);
          if (nx < 0 || ny < 0) continue;
          n += rcells[ny * W + nx]!;
        }
      }
      const alive = rcells[idx]! === 1;
      const next_alive = alive ? (n === 2 || n === 3) : (n === 3);
      wcells[idx] = next_alive ? 1 : 0;
    }
  }

  return rng;
}

// Resolve a neighbor coordinate honoring the axis boundary. Returns -1 for
// out-of-bounds in wall mode (caller skips the cell); wraps mod size in wrap
// mode.
function neighborIndex(c: number, size: number, wrap: boolean): number {
  if (wrap) {
    return ((c % size) + size) % size;
  }
  if (c < 0 || c >= size) return -1;
  return c;
}
