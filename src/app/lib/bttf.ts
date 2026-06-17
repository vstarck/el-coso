/* BTTF action helpers — shared by InspectorRail + PreviewCard.
   Centralizes the "checkout" + "branch from" semantics so the two surfaces
   never drift. Checkout is non-destructive: it auto-branches when the target
   tick is behind the branch head (preserves the original input log). Explicit
   destructive truncation should be a separate, confirmed action — not what
   "checkout" does by default. */

import {
  historyBranchFrom,
  historySetActiveBranch,
  historyStateAt,
} from "../../history";
import { session } from "../session";
import { useStore } from "../store";

let branchCounter = 1;
function nextBranchId(): string {
  return `side-${branchCounter++}`;
}

type CommitRef = { branchId: string; tick: number };

// Navigate to `c`. Non-destructive:
//   - same branch, at head_tick           → no-op (already there)
//   - different branch, at its head_tick  → just switch active
//   - earlier tick on any branch          → auto-branch from this commit + switch
// Returns the id of the newly-created branch, or null if none was created.
export function checkoutCommit(c: CommitRef): string | null {
  const h = session.history;
  const target = h.branches[c.branchId];
  if (!target) return null;
  if (c.tick === target.head_tick) {
    if (c.branchId !== h.active) {
      historySetActiveBranch(h, c.branchId);
      finalize();
    }
    return null;
  }
  const newId = nextBranchId();
  historyBranchFrom(h, c.branchId, c.tick, newId);
  historySetActiveBranch(h, newId);
  finalize();
  return newId;
}

// Explicit "branch from" — always creates a new sibling branch and switches
// to it, even when targeting head (lets the player explore an alternative
// future without going back in time first).
export function branchFromCommit(c: CommitRef): string {
  const h = session.history;
  const newId = nextBranchId();
  historyBranchFrom(h, c.branchId, c.tick, newId);
  historySetActiveBranch(h, newId);
  finalize();
  return newId;
}

// Non-destructive rewind — used when the active lens declares it cannot
// branch (e.g. deterministic Conway), and for "go to HEAD". Re-anchors the
// substrate at the target tick and leaves the future commits intact; the
// play/pause state is preserved (see `finalize`). If the loop is running,
// the lens detects substrate.tick < head_tick and replays forward via
// historyStateAt instead of emitting new ticks; if it is paused, the view
// simply rests at the target. The HEAD pin still marks where the run
// reached; the playhead pin moves with the observation point.
export function goBackToCommit(c: CommitRef): void {
  const h = session.history;
  if (c.branchId !== h.active) {
    historySetActiveBranch(h, c.branchId);
  }
  historyStateAt(h, c.branchId, c.tick);
  useStore.getState().setPlayheadTick(c.tick);
  finalize();
}

function finalize(): void {
  const s = useStore.getState();
  // Clear the inspector selection — the source commit shouldn't keep its
  // selection ring after the user has moved to a new branch / position.
  s.setSelectedCommit(null);
  s.bumpHistoryVersion();
  // Navigation is orthogonal to transport: preserve the play/pause state
  // across a jump. If the loop was running it keeps running (and, when the
  // playhead lands behind head, replays forward through the record); if it
  // was paused it stays paused at the new position. We deliberately do NOT
  // force-resume — going back from a paused state should stay paused.
}
