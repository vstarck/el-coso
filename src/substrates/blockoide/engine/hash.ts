// Content hash of a Blockoide configuration — the commit's *address* in
// the state-space sense: the same (well, piece pose, preview, score)
// reached along two input paths hashes identically, so recurrences are
// visible as equal addresses. Clock-ish fields (tick, accumulators,
// spawn_count) are excluded — they would make every address unique.
//
// FNV-1a, 32-bit, 8 hex chars. Equal hashes are a claim to verify against
// full state, never a proof (a short digest can collide).

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
    s.orient,
    s.piece_x + 8,
    s.piece_y + 8,
    s.piece_z + 8,
    s.next_kind + 1,
    s.layers,
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
