// tfps BTTF contract. A walkthrough has no discrete "events" (no piece lock, no
// kill), so the timeline gets a steady heartbeat: one commit every
// COMMIT_PERIOD ticks, carrying the pose. Enough for the tree to show the run
// advancing and for the scrubber/keyframes to work; the lens's commitGlyph reads
// the heading to draw a little compass arrow.

import type { HistoryAdapter } from "@/history/types";
import type { SubstrateState, TfpsInputs } from "./types";

export const COMMIT_PERIOD = 60; // ~1s at 60Hz base

export type TfpsCommitPayload = {
  tick: number;
  px: number;
  py: number;
  angle: number;
};

export function snapshotTfps(s: SubstrateState): TfpsCommitPayload {
  return { tick: s.tick, px: s.px, py: s.py, angle: s.angle };
}

export const tfpsBttfAdapter: HistoryAdapter<
  SubstrateState,
  TfpsInputs,
  TfpsCommitPayload
> = {
  root_commit: (s) => snapshotTfps(s),
  commit_predicate: (_before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null;
    return snapshotTfps(after);
  },
};
