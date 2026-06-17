import type { TronConfig, TronFoeBehavior, TronFoeSpawn } from "./config";
import type { TronDir } from "./types";

// Authoring-flat JSON in, runtime config out. Dimensions and survival
// target default sensibly; the player start pose defaults to arena center
// heading right; `foes` is optional (absent ⇒ pure solo survival).
export type LevelFile = {
  id: string;
  W?: number;
  H?: number;
  start_x?: number;
  start_y?: number;
  start_heading?: TronDir;
  survive_ticks?: number;
  foes?: FoeFile[];
};

export type FoeFile = {
  start_x?: number;
  start_y?: number;
  start_heading?: TronDir;
  aggression?: number;
  turn_pref?: "left" | "right";
  jitter?: number;
};

function isDir(v: unknown): v is TronDir {
  return v === "up" || v === "down" || v === "left" || v === "right";
}

function cl01(v: unknown, fallback: number): number {
  return typeof v === "number" ? Math.max(0, Math.min(1, v)) : fallback;
}

function parseBehavior(f: FoeFile): TronFoeBehavior {
  return {
    aggression: cl01(f.aggression, 0.3),
    turn_pref: f.turn_pref === "left" ? "left" : "right",
    jitter: cl01(f.jitter, 0.1),
  };
}

function parseFoes(raw: unknown, W: number, H: number): TronFoeSpawn[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): TronFoeSpawn => {
    const f = entry as FoeFile;
    return {
      start_x: typeof f.start_x === "number" ? f.start_x : Math.floor(W / 2),
      start_y: typeof f.start_y === "number" ? f.start_y : Math.floor(H / 2),
      start_heading: isDir(f.start_heading) ? f.start_heading : "left",
      behavior: parseBehavior(f),
    };
  });
}

export function parseLevel(json: unknown): TronConfig {
  const o = json as LevelFile;
  const W = typeof o.W === "number" ? o.W : 40;
  const H = typeof o.H === "number" ? o.H : 28;
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    W,
    H,
    start_x: typeof o.start_x === "number" ? o.start_x : Math.floor(W / 2),
    start_y: typeof o.start_y === "number" ? o.start_y : Math.floor(H / 2),
    start_heading: isDir(o.start_heading) ? o.start_heading : "right",
    survive_ticks: typeof o.survive_ticks === "number" ? o.survive_ticks : 240,
    foes: parseFoes(o.foes, W, H),
  };
}
