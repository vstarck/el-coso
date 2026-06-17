/* Spec §12 — floating commit preview card.
   308px wide glass-heavy, anchored above clicked node with diamond arrow.
   Thumbnail comes from lens.renderThumbnail(state, canvas) via the
   captureThumbnail helper; the lens chose the composition. */

import { useEffect, useMemo, useState } from "react";
import {
  X,
  ArrowRight,
  CornerDownRight,
  Eye,
  GitBranch,
  GitCompare,
  Pin,
  Rewind,
} from "lucide-react";
import { branchFromCommit, checkoutCommit, goBackToCommit } from "@/app/lib/bttf";
import {
  commitInHistory,
  drillDeeper,
  drillInto,
  isReviewing,
} from "@/app/lib/scenes/drill-in";
import { laneColorForStatus } from "@/lib/laneColor";
import { useHistoryView } from "@/app/lib/historyView";
import { session } from "@/app/session";
import { hashFmt, tickFmt } from "@/lib/tickFmt";
import { hasFeature } from "@/lenses/types";
import { captureThumbnail } from "@/app/lib/thumbnail";
import { useStore } from "@/app/store";

const CARD_WIDTH = 308;
const ARROW_GAP = 14;
const PAD_FROM_VIEWPORT_EDGE = 12;

export function PreviewCard() {
  const view = useHistoryView();
  const previewCommitId = useStore((s) => s.previewCommitId);
  const previewAnchor = useStore((s) => s.previewAnchor);
  const closePreview = useStore((s) => s.closePreview);
  const openCompare = useStore((s) => s.openCompare);
  const pinned = useStore((s) => s.pinned);
  const togglePin = useStore((s) => s.togglePin);
  const [vw, setVw] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const c = previewCommitId ? view.commitById[previewCommitId] : undefined;
  const b = c ? view.branchById[c.branchId] : undefined;

  const thumbnailUrl = useMemo(() => {
    if (!c) return null;
    return captureThumbnail(c.id, { branchId: c.branchId, tick: c.tick });
  }, [c?.id, c?.branchId, c?.tick]);

  if (!previewCommitId || !previewAnchor || !c || !b) return null;

  const dim = b.status === "abandoned";
  const seed = parseInt(c.hash.slice(0, 4), 16);

  // Clamp horizontally so the card never escapes the viewport.
  const minX = CARD_WIDTH / 2 + PAD_FROM_VIEWPORT_EDGE;
  const maxX = vw - CARD_WIDTH / 2 - PAD_FROM_VIEWPORT_EDGE;
  const x = Math.max(minX, Math.min(maxX, previewAnchor.x));
  const y = previewAnchor.y;

  const isPinned = pinned.includes(c.id);

  const canBranch = !hasFeature(session.active_lens, "SINGLE_BRANCH");

  const onCheckout = () => {
    checkoutCommit(c);
    closePreview();
  };

  const onBranchFromClick = () => {
    branchFromCommit(c);
    closePreview();
  };

  const onGoBack = () => {
    goBackToCommit(c);
    closePreview();
  };

  // Descend into this commit's retained child history. The chrome
  // owns the `c-<id>` format; resolve the raw commit from whatever history
  // is being viewed (parent, or an inner tree if already reviewing) and
  // dispatch to drillInto / drillDeeper accordingly.
  const onDrillIn = () => {
    const raw = commitInHistory(session.history, Number(c.id.slice(2)));
    if (!raw) return;
    if (isReviewing() ? drillDeeper(raw) : drillInto(raw)) closePreview();
  };

  return (
    <div
      className="glass-heavy pointer-events-auto"
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: CARD_WIDTH,
        borderRadius: 12,
        transform: `translate(-50%, calc(-100% - ${ARROW_GAP}px))`,
        zIndex: 30,
      }}
      role="dialog"
      aria-label={`Preview of commit ${hashFmt(c.hash)}`}
    >
      {/* Header — mirrors InspectorRail so the chrome reads consistently
         between the docked inspector panel and the floating preview. */}
      <div className="flex h-9 items-center justify-between border-b border-[var(--border)] px-3">
        <div className="flex items-center gap-2">
          <Eye size={12} className="text-fg-muted" />
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.14em] text-fg-muted">
            preview
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="chip font-mono">commit</span>
          <button
            type="button"
            onClick={closePreview}
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22 }}
            aria-label="Close preview"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {/* Body — pads the thumbnail, meta, and actions; the header sits
         flush. */}
      <div style={{ padding: 10 }}>

      {/* arrow */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: -7,
          width: 12,
          height: 12,
          transform: "translateX(-50%) rotate(45deg)",
          background: "var(--panel-3)",
          borderRight: "1px solid var(--border-3)",
          borderBottom: "1px solid var(--border-3)",
        }}
      />

      {/* thumbnail */}
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "#000",
          opacity: dim ? 0.6 : 1,
        }}
      >
        {thumbnailUrl ? (
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
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--fg-faint)",
              fontFamily: "Geist Mono",
              fontSize: "var(--text-xs)",
              letterSpacing: "0.1em",
            }}
          >
            ··· no thumbnail
          </div>
        )}
        <ThumbCorner pos="tl">{hashFmt(c.hash)}</ThumbCorner>
        <ThumbCorner pos="tr">{tickFmt(c.tick)}</ThumbCorner>
        <ThumbCorner pos="bl">
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: laneColorForStatus(b.status),
              display: "inline-block",
              marginRight: 5,
              verticalAlign: "middle",
            }}
          />
          {b.name}
        </ThumbCorner>
      </div>

      {/* meta */}
      <div className="mt-2.5 min-w-0">
        <div className="truncate text-[length:var(--text-base)] font-medium">
          {c.msg || `tick ${c.tick}`}
        </div>
        <div className="mt-0.5 font-mono text-[length:var(--text-xs)] text-fg-dim">
          id · {c.id} · seed-mix {(seed % 0xfff).toString(16)}
        </div>
      </div>

      {/* actions */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {c.hasInner && (
          <button
            type="button"
            className="btn col-span-2 justify-center"
            onClick={onDrillIn}
            title="Open the scene that resolved here and scrub its recording"
          >
            <CornerDownRight size={11} /> drill into scene
          </button>
        )}
        {canBranch ? (
          <button
            type="button"
            className="btn btn-primary justify-center"
            onClick={onCheckout}
          >
            <ArrowRight size={11} /> checkout
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary justify-center"
            onClick={onGoBack}
            title="Truncate the active branch at this commit and resume play"
          >
            <Rewind size={11} /> go back here
          </button>
        )}
        <button
          type="button"
          className="btn justify-center"
          onClick={() => openCompare(c.id, view.headCommitId ?? undefined)}
        >
          <GitCompare size={11} /> compare
        </button>
        {canBranch && (
          <button
            type="button"
            className="btn justify-center"
            onClick={onBranchFromClick}
          >
            <GitBranch size={11} /> branch
          </button>
        )}
        <button
          type="button"
          className="btn justify-center"
          onClick={() => togglePin(c.id)}
          aria-pressed={isPinned}
          style={
            isPinned
              ? {
                  background: "var(--accent-tint)",
                  borderColor: "var(--accent-edge)",
                  color: "var(--accent)",
                }
              : undefined
          }
        >
          <Pin size={11} /> {isPinned ? "pinned" : "pin"}
        </button>
      </div>
      </div>
    </div>
  );
}

function ThumbCorner({
  pos,
  children,
}: {
  pos: "tl" | "tr" | "bl";
  children: React.ReactNode;
}) {
  const base: React.CSSProperties = {
    position: "absolute",
    fontFamily: "Geist Mono",
    fontSize: "var(--text-2xs)",
    background: "rgba(0, 0, 0, 0.6)",
    color: "#fafafa",
    padding: "1px 5px",
    borderRadius: 3,
    letterSpacing: "0.04em",
  };
  if (pos === "tl")
    return <div style={{ ...base, top: 6, left: 6 }}>{children}</div>;
  if (pos === "tr")
    return <div style={{ ...base, top: 6, right: 6 }}>{children}</div>;
  return (
    <div
      style={{
        ...base,
        bottom: 6,
        left: 6,
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 6px",
      }}
    >
      {children}
    </div>
  );
}
