import { useRef } from "react";
import { ChevronUp, CornerDownRight, X } from "lucide-react";
import { PanelHeader } from "../chrome/PanelHeader";
import { StatusLine } from "./StatusLine";
import { TimelineTree } from "./TimelineTree";
import { useElementSize } from "@/app/lib/useElementSize";
import { useHistoryView } from "@/app/lib/historyView";
import { useStore } from "@/app/store";
import {
  ascend,
  ascendToRoot,
  resolveInnerSubstrate,
} from "@/app/lib/scenes/drill-in";

export function TimelinePanel({ onClose }: { onClose?: () => void }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const { width } = useElementSize(bodyRef);
  const view = useHistoryView();
  const compareOpen = useStore((s) => s.compareOpen);
  const openCompare = useStore((s) => s.openCompare);
  const pinned = useStore((s) => s.pinned);
  const selectedCommitId = useStore((s) => s.selectedCommitId);

  return (
    <div className="glass-med rounded-panel flex h-full flex-col">
      <PanelHeader
        label={
          <span>
            History{" "}
            <span className="text-fg-dim">
              · {view.commits.length} commits · {view.branches.length} branches
            </span>
          </span>
        }
        trailing={
          <>
            <button
              type="button"
              className="btn btn-ghost h-6 text-[length:var(--text-xs)]"
              onClick={() => {
                const head = view.headCommitId ?? undefined;
                const a = selectedCommitId ?? head;
                openCompare(a ?? undefined, head);
              }}
              aria-pressed={compareOpen}
              disabled={!view.headCommitId}
            >
              compare
            </button>
            <span className="chip">pinned · {pinned.length}</span>
          </>
        }
        onClose={onClose}
      />
      <ReviewBar />
      <div ref={bodyRef} className="relative flex-1 overflow-hidden">
        {width > 0 && <TimelineTree width={width} view={view} />}
      </div>
      <StatusLine />
    </div>
  );
}

// Drill-in breadcrumb + ascend controls. Visible only while a
// review path is non-empty; the timeline below it is already re-rooted at
// the inner history (session.history projects the review frame). Subscribes
// to `drill` so it tracks descend/ascend; reads each step's substrate via A′.
function ReviewBar() {
  const drill = useStore((s) => s.drill);
  if (drill.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[length:var(--text-xs)]">
      <CornerDownRight size={12} className="shrink-0 text-accent" />
      <span className="font-mono uppercase tracking-[0.14em] text-fg-muted">
        reviewing
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {drill.map((step, i) => {
          let label = "scene";
          try {
            label = resolveInnerSubstrate(step.history).substrate_id;
          } catch {
            /* unregistered bundle — keep the neutral label */
          }
          return (
            <span key={`${step.origin_commit_id}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span className="text-fg-faint">/</span>}
              <span
                className="chip font-mono"
                style={
                  i === drill.length - 1
                    ? { borderColor: "var(--accent-edge)", color: "var(--accent)" }
                    : undefined
                }
              >
                {label}
              </span>
            </span>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-ghost h-6 text-[length:var(--text-xs)]"
        onClick={ascend}
        title="Ascend one level"
      >
        <ChevronUp size={12} /> up
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        style={{ width: 24, height: 24 }}
        onClick={ascendToRoot}
        aria-label="Exit review"
        title="Exit review"
      >
        <X size={11} />
      </button>
    </div>
  );
}
