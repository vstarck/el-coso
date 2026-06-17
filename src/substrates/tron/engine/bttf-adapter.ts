// Tron's BTTF contract. Commits give the timeline scrub points without one
// node per tick: a periodic heartbeat plus a guaranteed commit on the
// terminal edge (the crash or the win), so the death/win is always a
// timeline marker. Per-tick *inputs* are recorded by historyTick
// regardless — this predicate only governs commit density.

import type { HistoryAdapter } from "@/history/types";
import type { SubstrateState, TronInputs, TronOutcome } from "./types";

export const COMMIT_PERIOD = 12;

export type TronCommitPayload = {
  tick: number;
  outcome: TronOutcome;
  head_x: number;
  head_y: number;
  filled: number; // occupied cell count — trail-length proxy for the glyph
  foes_alive: number; // how many AI cycles are still running
};

function fillCount(s: SubstrateState): number {
  let n = 0;
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] !== 0) n++;
  return n;
}

function foesAlive(s: SubstrateState): number {
  let n = 0;
  for (const f of s.foes) if (f.alive === 1) n++;
  return n;
}

export function snapshotTron(s: SubstrateState): TronCommitPayload {
  return {
    tick: s.tick,
    outcome: s.outcome,
    head_x: s.head_x,
    head_y: s.head_y,
    filled: fillCount(s),
    foes_alive: foesAlive(s),
  };
}

export const tronBttfAdapter: HistoryAdapter<
  SubstrateState,
  TronInputs,
  TronCommitPayload
> = {
  root_commit: (s) => snapshotTron(s),
  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    const terminal_edge =
      before.outcome === "in_progress" && after.outcome !== "in_progress";
    if (terminal_edge) return snapshotTron(after); // always mark the end
    if (after.outcome !== "in_progress") return null; // frozen — done emitting
    if (after.tick % COMMIT_PERIOD !== 0) return null;
    return snapshotTron(after);
  },
};
