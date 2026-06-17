// Content hash of a Pentris configuration — the commit's *address* in the
// state-space sense: the same (stack, piece, preview, score) reached along
// two different input paths hashes identically, so recurrences are visible
// as equal addresses. Clock-ish fields (tick, accumulators, spawn_count)
// are deliberately excluded — they would make every address unique and no
// two commits could ever coincide.
//
// FNV-1a, 32-bit, rendered as 8 hex chars. Wide enough for a play
// session's worth of commits; equal hashes are still a claim to verify
// against full state, never a proof (a short digest can collide).

import type { SubstrateState } from "./types";

const OUTCOME_CODE: Record<string, number> = {
  in_progress: 0,
  won: 1,
  lost: 2,
};

export function hashState(s: SubstrateState): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.cells.length; i++) {
    h ^= s.cells[i] ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  const scalars = [
    s.piece_kind + 1,
    s.piece_rot,
    s.piece_x + 8,
    s.piece_y + 8,
    s.next_kind + 1,
    s.lines,
    OUTCOME_CODE[s.outcome] ?? 3,
  ];
  for (const v of scalars) {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
