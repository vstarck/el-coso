// Conway's BTTF contract for the history layer.
//
// Conway has no player input, so commits aren't naturally rate-limited the
// way an input-driven world's are (one commit per move). We emit a commit every
// COMMIT_PERIOD generations — gives the BTTF tree a sensible cadence at
// any play speed. Bump this number to thin the timeline, lower it to
// snapshot finer detail. The payload carries `tick` and `alive_count`;
// future milestone events (extinction, oscillator detection) can layer on
// without changing the shape.

import type { HistoryAdapter } from "@/history/types";
import type { ConwayInputs, SubstrateState } from "./types";

export const COMMIT_PERIOD = 100;

export type ConwayCommitPayload = {
  tick: number;
  alive_count: number;
  // Lens-tier annotation. The substrate predicate never sets this — it's
  // produced by `historyAnnotate` when the lens detects evolution has
  // halted (period-1 still-life or period-2 oscillator). Renders as the
  // end-of-line glyph on the timeline.
  outcome?: "halted";
};

export function snapshotConway(s: SubstrateState): ConwayCommitPayload {
  let alive = 0;
  const cells = s.cells;
  for (let i = 0; i < cells.length; i++) alive += cells[i]!;
  return { tick: s.tick, alive_count: alive };
}

export const conwayBttfAdapter: HistoryAdapter<
  SubstrateState,
  ConwayInputs,
  ConwayCommitPayload
> = {
  root_commit: (state) => snapshotConway(state),
  commit_predicate: (_before, after, _input) => {
    if (after.tick === 0) return null; // root commit covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null;
    return snapshotConway(after);
  },
};
