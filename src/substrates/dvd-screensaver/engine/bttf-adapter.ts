// DVD-screensaver BTTF contract — one commit every COMMIT_PERIOD ticks so the
// timeline has a heartbeat. Zero input → SINGLE_BRANCH; the timeline is a
// pure record of autonomous motion. The payload carries the particle speed so
// the commit glyph can color by how fast it's moving.

import type { HistoryAdapter } from "@/history/types";
import type { DvdInputs, SubstrateState } from "./types";

export const COMMIT_PERIOD = 50;

export type DvdCommitPayload = {
  tick: number;
  speed: number; // |pos − prev| of particle 0 (implicit Verlet velocity)
};

export function snapshotDvd(s: SubstrateState): DvdCommitPayload {
  const vx = (s.px[0] ?? 0) - (s.ppx[0] ?? 0);
  const vy = (s.py[0] ?? 0) - (s.ppy[0] ?? 0);
  return { tick: s.tick, speed: Math.hypot(vx, vy) };
}

export const dvdBttfAdapter: HistoryAdapter<
  SubstrateState,
  DvdInputs,
  DvdCommitPayload
> = {
  root_commit: (s) => snapshotDvd(s),
  commit_predicate: (_before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null;
    return snapshotDvd(after);
  },
};
