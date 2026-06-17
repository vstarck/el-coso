// tts's BTTF contract for the history layer. One commit per piece lock
// (spawn_count change) plus the terminal edge — gives the timeline a
// per-piece cadence at any play speed. The payload carries enough for the
// lens's commit glyph (the falling piece's letter) and outcome banner.

import type { HistoryAdapter } from "@/history/types";
import { PIECE_NAMES } from "./pieces";
import type { TtsInputs, SubstrateState, TtsOutcome } from "./types";

export type TtsCommitPayload = {
  tick: number;
  lines: number;
  piece: string; // glyph of the piece now falling ("-" before first spawn)
  outcome: TtsOutcome;
};

export function snapshotTts(s: SubstrateState): TtsCommitPayload {
  return {
    tick: s.tick,
    lines: s.lines,
    piece: s.piece_kind >= 0 ? PIECE_NAMES[s.piece_kind] ?? "?" : "-",
    outcome: s.outcome,
  };
}

export const ttsBttfAdapter: HistoryAdapter<
  SubstrateState,
  TtsInputs,
  TtsCommitPayload
> = {
  root_commit: (state) => snapshotTts(state),
  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root commit covers tick 0
    // Terminal edge — snapshot the moment the run ends.
    if (after.outcome !== "in_progress" && before.outcome === "in_progress") {
      return snapshotTts(after);
    }
    // One commit per piece lock.
    if (after.spawn_count !== before.spawn_count) return snapshotTts(after);
    return null;
  },
};
