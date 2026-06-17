/* Spec §9 — Inspector rail.
   Reads selectedCommitId from store; identity + payload-vs-parent rows
   come from useHistoryView. Footer actions wire to the BTTF primitives. */

import { useMemo } from "react";
import { ArrowRight, Columns, Eye, FastForward, GitBranch, GitCompare, Rewind, X } from "lucide-react";
import { branchFromCommit, checkoutCommit, goBackToCommit } from "@/app/lib/bttf";
import { laneColorForStatus } from "@/lib/laneColor";
import { useHistoryView } from "@/app/lib/historyView";
import { session } from "@/app/session";
import { hashFmt, tickFmt } from "@/lib/tickFmt";
import { hasFeature } from "@/lenses/types";
import { captureThumbnail } from "@/app/lib/thumbnail";
import { useStore } from "@/app/store";
import type { Params } from "@/lib/types";

export function InspectorRail({ onClose }: { onClose?: () => void }) {
  const view = useHistoryView();
  const selectedCommitId = useStore((s) => s.selectedCommitId);
  const openCompare = useStore((s) => s.openCompare);
  const canBranch = !hasFeature(session.active_lens, "SINGLE_BRANCH");

  const id = selectedCommitId ?? view.headCommitId;
  const c = id ? view.commitById[id] : undefined;
  const br = c ? view.branchById[c.branchId] : undefined;
  const parent = c?.parentCommitId ? view.commitById[c.parentCommitId] : undefined;

  const rows = c?.params ? buildDiffRows(c.params, parent?.params) : [];

  const thumbnailUrl = useMemo(() => {
    if (!c) return null;
    return captureThumbnail(c.id, { branchId: c.branchId, tick: c.tick });
  }, [c?.id, c?.branchId, c?.tick]);

  const onCheckout = () => {
    if (!c) return;
    checkoutCommit(c);
  };

  const onBranchFrom = () => {
    if (!c) return;
    branchFromCommit(c);
  };

  const onGoBack = () => {
    if (!c) return;
    goBackToCommit(c);
  };

  // Jump the playhead to the live frontier (active branch's head_tick),
  // mirroring the toolbar's fast-forward-to-head. Preserves play/pause.
  const onGoToHead = () => {
    const h = session.history;
    const active = h.branches[h.active];
    if (!active) return;
    goBackToCommit({ branchId: active.id, tick: active.head_tick });
  };

  const onCompareClick = () => {
    if (!c) return;
    openCompare(c.id, view.headCommitId ?? undefined);
  };

  return (
    <div className="glass-med rounded-panel flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-[var(--border)] px-3">
        <div className="flex items-center gap-2">
          <Eye size={12} className="text-fg-muted" />
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
            inspector
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="chip font-mono">commit</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon"
              style={{ width: 22, height: 22 }}
              aria-label="Hide inspector"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {c && br ? (
        <>
          {/* Thumbnail — lens-rendered preview of this commit. Quiet when
             the lens declines to provide one (renderThumbnail undefined or
             returned null). */}
          {thumbnailUrl && (
            <div className="border-b border-[var(--border)] px-3 py-3">
              <div
                style={{
                  position: "relative",
                  aspectRatio: "16 / 9",
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  background: "#000",
                  opacity: br.status === "abandoned" ? 0.6 : 1,
                }}
              >
                <img
                  src={thumbnailUrl}
                  alt=""
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
              </div>
            </div>
          )}

          {/* Identity */}
          <div className="border-b border-[var(--border)] px-3 py-3">
            <div className="font-mono text-[length:var(--text-lg)] font-semibold tracking-tight">
              {hashFmt(c.hash)}
            </div>
            {c.msg && (
              <div className="mt-0.5 text-[length:var(--text-base)] text-fg-muted">{c.msg}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="chip font-mono">
                <span
                  className="chip-dot"
                  style={{ background: laneColorForStatus(br.status) }}
                />
                {br.name}
              </span>
              <span className="chip font-mono">{tickFmt(c.tick)}</span>
              {parent && (
                <span
                  className="chip font-mono"
                  style={{ color: "var(--fg-dim)" }}
                >
                  ← {hashFmt(parent.hash)}
                </span>
              )}
            </div>
          </div>

          {/* Section header */}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-dim">
              payload · vs parent
            </div>
            <Columns size={11} className="text-fg-dim" />
          </div>

          {/* Diff rows */}
          <div className="flex-1 overflow-auto px-2 pb-2">
            {rows.length === 0 && (
              <div className="px-2 py-3 text-[length:var(--text-sm)] text-fg-faint">
                no payload
              </div>
            )}
            {rows.map((row) => (
              <div
                key={row.key}
                className="mb-0.5 flex items-center justify-between rounded-md px-2 py-1.5"
                style={{
                  background: row.changed ? "var(--accent-row-bg)" : "transparent",
                  borderLeft: row.changed
                    ? "2px solid var(--accent-edge)"
                    : "2px solid transparent",
                }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="font-mono text-[length:var(--text-xs)] uppercase tracking-wider text-fg-faint"
                    style={{ width: 44 }}
                  >
                    {row.group}
                  </span>
                  <span className="truncate text-[length:var(--text-sm)] text-fg">{row.label}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 font-mono text-[length:var(--text-sm)]">
                  {row.changed && row.prev !== undefined && (
                    <span
                      style={{
                        color: "var(--fg-faint)",
                        textDecoration: "line-through",
                      }}
                    >
                      {fmtPayloadValue(row.prev)}
                    </span>
                  )}
                  <span
                    style={{ color: row.changed ? "var(--accent)" : "var(--fg)" }}
                  >
                    {fmtPayloadValue(row.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 px-3 py-6 text-[length:var(--text-sm)] text-fg-faint">
          No commit selected.
        </div>
      )}

      {/* Footer actions — only present when a commit resolves; otherwise
         the rail shows just the empty-state message above. */}
      {c && br && (
        <div className="flex items-center gap-1.5 border-t border-[var(--border)] px-3 py-2.5">
          {canBranch ? (
            <button
              type="button"
              className="btn btn-primary flex-1 justify-center"
              onClick={onCheckout}
            >
              <ArrowRight size={11} /> checkout
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary flex-1 justify-center"
              onClick={onGoBack}
              title="Re-anchor the run at this commit (non-destructive; preserves play/pause)"
            >
              <Rewind size={11} /> go back here
            </button>
          )}
          {canBranch && (
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Branch from this commit"
              onClick={onBranchFrom}
            >
              <GitBranch size={11} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Go to HEAD"
            title="Go to HEAD — jump to the live frontier"
            onClick={onGoToHead}
          >
            <FastForward size={11} />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Compare"
            onClick={onCompareClick}
          >
            <GitCompare size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

type DiffRow = {
  key: string;
  group: string;
  label: string;
  value: number | boolean | string;
  prev: number | boolean | string | undefined;
  changed: boolean;
};

function buildDiffRows(params: Params, parent: Params | undefined): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [key, value] of Object.entries(params)) {
    const prev = parent ? parent[key] : undefined;
    rows.push({
      key,
      group: deriveGroup(key),
      label: deriveLabel(key),
      value,
      prev,
      changed: prev !== undefined && prev !== value,
    });
  }
  return rows;
}

function deriveGroup(key: string): string {
  if (key.startsWith("ghost_")) return "ghost";
  if (key.startsWith("pacman_")) return "pacman";
  return "game";
}

function deriveLabel(key: string): string {
  if (key.startsWith("ghost_")) return key.slice("ghost_".length);
  if (key.startsWith("pacman_")) return key.slice("pacman_".length);
  return key;
}

function fmtPayloadValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? `${v}` : v.toFixed(2);
  return String(v);
}
