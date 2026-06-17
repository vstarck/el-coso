import type { TtsConfig } from "./config";

// Authoring-side JSON shape. One file per puzzle in `./puzzles/`. Flat and
// all-optional-but-id; parseLevel fills the classic 10×20 defaults.
export type LevelFile = {
  id: string;
  description?: string;
  W?: number;
  H?: number;
  gravity_period?: number;
  move_period?: number;
  win_lines?: number;
};

export function parseLevel(level: LevelFile): TtsConfig {
  const W = level.W ?? 10;
  const H = level.H ?? 20;
  if (W <= 0 || H <= 0) {
    throw new Error(`invalid tts level "${level.id}": dimensions ${W}x${H}`);
  }
  return {
    id: level.id,
    W,
    H,
    gravity_period: level.gravity_period ?? 30,
    move_period: level.move_period ?? 6,
    win_lines: level.win_lines ?? 0,
  };
}
