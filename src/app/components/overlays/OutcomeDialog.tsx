/* OutcomeDialog — chrome-level modal that opens when the active lens
 * declares a commit as terminal via `MountedLens.outcomeFor`. Polls on
 * historyVersion changes, finds the active branch's head commit, asks
 * the lens for an OutcomeBanner; if non-null and the commit hasn't been
 * shown before, opens.
 *
 * Two actions:
 *   - Dismiss: close the dialog, keep the substrate parked on the
 *     terminal frame. Player can keep scrubbing / branching.
 *   - Try again: branch from the puzzle's root commit (tick 0 on the
 *     root branch) and switch to the new branch. The terminal run stays
 *     in the timeline as history; the player gets a fresh attempt
 *     forked from the same starting state. No substrate rebuild.
 *
 * Re-trigger semantics: the dialog opens at most once per (sessionVersion,
 * commit id) pair. Scrubbing back to a non-terminal commit then forward
 * to the same terminal commit won't re-fire. A new terminal commit on a
 * different branch will.
 */

import { useEffect, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { historyActiveBranch } from "@/history";
import { branchFromCommit } from "@/app/lib/bttf";
import { isSceneChild } from "@/app/lib/scenes/scene-stack";
import { isReviewing } from "@/app/lib/scenes/drill-in";
import { session } from "@/app/session";
import { useStore } from "@/app/store";
import { hasFeature, type OutcomeBanner } from "@/lenses/types";
import type { Params } from "@/lib/types";

type DialogState = {
  banner: OutcomeBanner;
  commitId: string;
};

const STATUS_ACCENT: Record<OutcomeBanner["status"], string> = {
  won: "#22c55e",
  lost: "#ef4444",
  draw: "#9ca3af",
};

const STATUS_LABEL: Record<OutcomeBanner["status"], string> = {
  won: "win",
  lost: "loss",
  draw: "draw",
};

export function OutcomeDialog() {
  const historyVersion = useStore((s) => s.historyVersion);
  const sessionVersion = useStore((s) => s.sessionVersion);

  const [state, setState] = useState<DialogState | null>(null);
  const [lastShownId, setLastShownId] = useState<string | null>(null);

  // On session change (substrate / puzzle / reset), clear all tracking
  // so the next terminal commit on the fresh history can open the dialog.
  useEffect(() => {
    setState(null);
    setLastShownId(null);
  }, [sessionVersion]);

  // Poll the active branch's head commit on every history bump.
  useEffect(() => {
    // While a spawned child scene is active, the scene runtime owns the
    // return-to-parent flow (auto-pop + exit cutscene); the child's terminal
    // banner would block it. The parent's own terminal still fires on resume.
    if (isSceneChild()) return;
    // While drilled in the head we'd poll is a RECORDING parked at
    // its terminal — reviewing a resolved battle must not pop the live
    // "Victory" modal (and "Try again" would branch the inner history).
    if (isReviewing()) return;
    const mounted = session.mounted_lens;
    if (!mounted || !mounted.outcomeFor) return;
    const branch = historyActiveBranch(session.history);
    const head = branch.commits[branch.commits.length - 1];
    if (!head) return;
    const headId = String(head.id);
    if (headId === lastShownId) return;
    const banner = mounted.outcomeFor(head.payload as Params);
    if (banner === null) return;
    setState({ banner, commitId: headId });
    setLastShownId(headId);
  }, [historyVersion, lastShownId]);

  if (state === null) return null;

  const accent = STATUS_ACCENT[state.banner.status];
  const label = STATUS_LABEL[state.banner.status];
  // SINGLE_BRANCH lenses replay deterministically — branching from root
  // produces the same history, so "Try again" would be a no-op tease.
  // Hide it; the player can still dismiss and pick a new puzzle.
  const canTryAgain = !hasFeature(session.active_lens, "SINGLE_BRANCH");

  function onDismiss() {
    setState(null);
  }
  function onTryAgain() {
    // Branch from the puzzle's root commit so the failed/won run stays
    // visible on the timeline as history. The new branch's head is at
    // tick 0; sync the playhead so the chrome reflects the rewind.
    branchFromCommit({
      branchId: session.history.root_branch_id,
      tick: 0,
    });
    useStore.getState().setPlayheadTick(0);
    setState(null);
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.45)" }}
      onClick={onDismiss}
    >
      <div
        className="glass-heavy"
        style={{
          width: 360,
          borderRadius: 12,
          borderTop: `3px solid ${accent}`,
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="chip font-mono uppercase"
              style={{ color: accent, borderColor: accent }}
            >
              {label}
            </span>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
              outcome
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            onClick={onDismiss}
            aria-label="Close outcome dialog"
          >
            <X size={11} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 18px" }}>
          <div
            style={{
              fontSize: "var(--text-lg)",
              fontWeight: 600,
              color: "var(--fg)",
              marginBottom: state.banner.body ? 6 : 0,
            }}
          >
            {state.banner.title}
          </div>
          {state.banner.body && (
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--fg-muted)",
              }}
            >
              {state.banner.body}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "10px 12px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onDismiss}
          >
            Dismiss
          </button>
          {canTryAgain && (
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={onTryAgain}
              title="Branch from the puzzle's start; keeps this run on the timeline."
            >
              <RotateCcw size={12} />
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
