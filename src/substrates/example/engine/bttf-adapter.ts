// Example substrate's BTTF contract — one commit every COMMIT_PERIOD
// ticks so the timeline has a sensible heartbeat. Replace with the real
// substrate's commit cadence when authoring (Conway emits every 100
// ticks for a stable density; a keyboard arcade emits on every accepted
// move; a turn game on every tick because each tick is intentful).

import type { HistoryAdapter } from "@/history/types";
import type { ExampleInputs, SubstrateState } from "./types";

export const COMMIT_PERIOD = 50;

export type ExampleCommitPayload = {
  tick: number;
  // Sum of every cell's counter at commit time. Plenty for the
  // timeline's commitGlyph to color-code activity.
  total: number;
};

export function snapshotExample(s: SubstrateState): ExampleCommitPayload {
  let total = 0;
  for (let i = 0; i < s.counter.length; i++) total += s.counter[i] ?? 0;
  return { tick: s.tick, total };
}

export const exampleBttfAdapter: HistoryAdapter<
  SubstrateState,
  ExampleInputs,
  ExampleCommitPayload
> = {
  root_commit: (s) => snapshotExample(s),
  commit_predicate: (_before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null;
    return snapshotExample(after);
  },
};
