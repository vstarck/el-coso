// abismo's BTTF contract. Per-tick inputs are recorded by historyTick
// regardless; this predicate governs commit (timeline node) density. The commit
// carries `depth` so the timeline preview / glyph reflects how deep the dive was.
import type { HistoryAdapter } from "@/history/types";
import type { AbismoInputs, SubstrateState } from "./types";

export const COMMIT_PERIOD = 50;

export type AbismoCommitPayload = {
  tick: number;
  depth: number;
};

export function snapshotAbismo(s: SubstrateState): AbismoCommitPayload {
  return { tick: s.tick, depth: s.depth };
}

export const abismoBttfAdapter: HistoryAdapter<
  SubstrateState,
  AbismoInputs,
  AbismoCommitPayload
> = {
  root_commit: (s) => snapshotAbismo(s),
  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null; // rate-limit
    // Parked at a depth (no scroll, auto-dive off) — no motion worth a node.
    if (before.depth === after.depth) return null;
    return snapshotAbismo(after);
  },
};
