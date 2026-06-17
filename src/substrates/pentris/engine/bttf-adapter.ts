// Pentris's BTTF contract (Q6: per-event). A commit is a *placement*: it
// lands on the tick a falling piece locks into the stack and its rows
// resolve. The very first spawn locks nothing, so it mints no commit —
// the root covers it. A guaranteed commit on the terminal edge keeps the
// win/top-out a timeline marker. Per-tick *inputs* (including rotations
// and moves mid-fall) are recorded by historyTick regardless — they
// replay bit-exact but never become timeline nodes; the commit tree reads
// as the sequence of placements.

import type { HistoryAdapter } from "@/history/types";
import type { PentrisOutcome, PentrisInputs, SubstrateState } from "./types";
import { PIECE_NAMES } from "./pieces";
import { hashState } from "./hash";

export type PentrisCommitPayload = {
  tick: number;
  piece: string; // the piece this placement locked — what the glyph shows
  falling: string; // the piece entering at the top after the lock
  cleared: number; // rows resolved by this placement
  lines: number; // cleared total after the placement
  // Content hash of the configuration — the commit's address (see hash.ts).
  // Two placements that reconverge on the same configuration share it.
  hash: string;
  outcome: PentrisOutcome;
};

export function pentrisPayload(
  before: SubstrateState,
  after: SubstrateState,
): PentrisCommitPayload {
  return {
    tick: after.tick,
    piece: PIECE_NAMES[before.piece_kind] ?? "·",
    falling: PIECE_NAMES[after.piece_kind] ?? "·",
    cleared: after.lines - before.lines,
    lines: after.lines,
    hash: hashState(after),
    outcome: after.outcome,
  };
}

export const pentrisBttfAdapter: HistoryAdapter<
  SubstrateState,
  PentrisInputs,
  PentrisCommitPayload
> = {
  root_commit: (s) => pentrisPayload(s, s),
  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    const terminal_edge =
      before.outcome === "in_progress" && after.outcome !== "in_progress";
    if (terminal_edge) return pentrisPayload(before, after);
    if (after.outcome !== "in_progress") return null; // frozen — done emitting
    // A placement: the piece that was falling locked (the first spawn has
    // before.piece_kind === -1 and locks nothing).
    if (after.spawn_count > before.spawn_count && before.piece_kind >= 0) {
      return pentrisPayload(before, after);
    }
    return null;
  },
};
