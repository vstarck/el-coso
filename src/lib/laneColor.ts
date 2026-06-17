/* Spec §4 — pluggable lane-color function. Now: status lookup.
   Later: hash(branchId | depth) → oklch. Keep this signature stable. */

import type { BranchStatus } from "./types";

const LANE_TONE: Record<BranchStatus, string> = {
  active: "var(--lane-active)",
  alive: "var(--lane-alive)",
  stale: "var(--lane-stale)",
  abandoned: "var(--lane-abandoned)",
};

// Status-driven tone — the live, leak-free form. Callers hold a live branch
// object and pass its status directly (no fixture lookup), so the color always
// reflects live history.
export function laneColorForStatus(status: BranchStatus): string {
  return LANE_TONE[status];
}
