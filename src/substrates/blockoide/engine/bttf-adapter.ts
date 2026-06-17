// Blockoide's BTTF contract (per-event). A commit is a *placement*: it
// lands on the tick a falling piece locks into the well and its layers
// resolve. The first spawn locks nothing, so it mints no commit — the root
// covers it. A guaranteed commit on the terminal edge keeps the win/top-out
// a timeline marker. Per-tick *inputs* are recorded by historyTick
// regardless — they replay bit-exact but never become timeline nodes; the
// commit tree reads as the sequence of placements.

import type { HistoryAdapter } from "@/history/types";
import type { BlockoideInputs, BlockoideOutcome, SubstrateState } from "./types";
import { PIECE_NAMES } from "./pieces";
import { hashState } from "./hash";

export type BlockoideCommitPayload = {
  tick: number;
  piece: string; // the piece this placement locked — what the glyph shows
  falling: string; // the piece entering at the opening after the lock
  cleared: number; // layers resolved by this placement
  layers: number; // cleared total after the placement
  hash: string; // content hash — the commit's address
  outcome: BlockoideOutcome;
};

export function blockoidePayload(
  before: SubstrateState,
  after: SubstrateState,
): BlockoideCommitPayload {
  return {
    tick: after.tick,
    piece: PIECE_NAMES[before.piece_kind] ?? "·",
    falling: PIECE_NAMES[after.piece_kind] ?? "·",
    cleared: after.layers - before.layers,
    layers: after.layers,
    hash: hashState(after),
    outcome: after.outcome,
  };
}

export const blockoideBttfAdapter: HistoryAdapter<
  SubstrateState,
  BlockoideInputs,
  BlockoideCommitPayload
> = {
  root_commit: (s) => blockoidePayload(s, s),
  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    const terminal_edge =
      before.outcome === "in_progress" && after.outcome !== "in_progress";
    if (terminal_edge) return blockoidePayload(before, after);
    if (after.outcome !== "in_progress") return null; // frozen — done emitting
    // A placement: the piece that was falling locked (the first spawn has
    // before.piece_kind === -1 and locks nothing).
    if (after.spawn_count > before.spawn_count && before.piece_kind >= 0) {
      return blockoidePayload(before, after);
    }
    return null;
  },
};
