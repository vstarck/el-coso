/* Footer beneath the timeline tree — two BTTF actions reachable without
   touching a node: recenter the pan back onto the live head, and branch
   from the active branch's current head commit. */

import { GitBranch, LocateFixed, Scaling } from "lucide-react";
import { branchFromCommit } from "@/app/lib/bttf";
import { useHistoryView } from "@/app/lib/historyView";
import { session } from "@/app/session";
import { hasFeature } from "@/lenses/types";
import { useStore } from "@/app/store";

export function StatusLine() {
  const view = useHistoryView();
  const recenterTimeline = useStore((s) => s.recenterTimeline);
  const timelineStrategy = useStore((s) => s.timelineStrategy);
  const cycleTimelineStrategy = useStore((s) => s.cycleTimelineStrategy);
  const folding = timelineStrategy !== "none";
  const canBranch = !hasFeature(session.active_lens, "SINGLE_BRANCH");

  const onRecenter = () => {
    recenterTimeline();
    useStore.getState().setSelectedCommit(null);
  };

  const onBranchCurrent = () => {
    const active = session.history.branches[view.activeBranchId];
    if (!active) return;
    branchFromCommit({ branchId: active.id, tick: active.head_tick });
  };

  return (
    <div className="flex h-7 items-center gap-1.5 border-t border-[var(--border)] px-3">
      <div className="flex-1" />
      <button
        type="button"
        onClick={cycleTimelineStrategy}
        className="btn btn-ghost"
        style={{ height: 22, padding: "0 7px" }}
        aria-pressed={folding}
        title="Cycle commit clumping: off (panned) → fit (uniform) → recent (gradient, newest kept whole)"
      >
        <Scaling size={11} /> fold ·{timelineStrategy}
      </button>
      <button
        type="button"
        onClick={onRecenter}
        className="btn btn-ghost"
        style={{ height: 22, padding: "0 7px" }}
        title="Snap the timeline pan back onto the live head"
        disabled={folding}
      >
        <LocateFixed size={11} /> recenter
      </button>
      {canBranch && (
        <button
          type="button"
          onClick={onBranchCurrent}
          className="btn btn-ghost"
          style={{ height: 22, padding: "0 7px" }}
          title="Create a new branch from the current head"
        >
          <GitBranch size={11} /> branch current
        </button>
      )}
    </div>
  );
}
