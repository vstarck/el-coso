import type { ChannelBag } from "@/engine/channels";
import type { DvdConfig } from "./config";
import type { SubstrateState } from "./types";

function f32(bag: ChannelBag, name: string): Float32Array {
  const arr = bag[name];
  if (!(arr instanceof Float32Array)) {
    throw new Error(`channel '${name}' missing or not Float32Array`);
  }
  return arr;
}

// Wire an engine-allocated channel bag into the typed Verlet state.
export function makeState(bag: ChannelBag, config: DvdConfig): SubstrateState {
  return {
    n: config.n,
    world_w: config.world_w,
    world_h: config.world_h,
    px: f32(bag, "px"),
    py: f32(bag, "py"),
    ppx: f32(bag, "ppx"),
    ppy: f32(bag, "ppy"),
    ax: f32(bag, "ax"),
    ay: f32(bag, "ay"),
    jx: f32(bag, "jx"),
    jy: f32(bag, "jy"),
    tick: 0,
  };
}

// Seed the read side: position at the authored start, and previous-position
// back-derived from the initial velocity so the first Verlet step carries
// the right momentum (implicit velocity = pos − prev). The first tick fills
// the write side. (n=1 by default; multi-particle seeds all identically —
// varied placement is a later scene.)
export function initState(state: SubstrateState, config: DvdConfig): void {
  for (let i = 0; i < config.n; i++) {
    state.px[i] = config.init_x;
    state.py[i] = config.init_y;
    state.ppx[i] = config.init_x - config.init_vx * config.dt;
    state.ppy[i] = config.init_y - config.init_vy * config.dt;
  }
}
