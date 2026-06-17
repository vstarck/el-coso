/* Spec §13 — Compare overlay. Three modes: split / wipe / onion.
   Each side is a real lens-rendered thumbnail captured via
   captureThumbnail(commitId). Browser scales the data URL to fit the
   comparator surface. */

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { laneColorForStatus } from "@/lib/laneColor";
import { useHistoryView } from "@/app/lib/historyView";
import { hashFmt, tickFmt } from "@/lib/tickFmt";
import { captureThumbnail } from "@/app/lib/thumbnail";
import { useStore } from "@/app/store";
import type { Branch, Commit } from "@/lib/types";
import type { CompareMode } from "@/app/store";
import { ErrorBoundary } from "./ErrorBoundary";

const MODES: { id: CompareMode; label: string }[] = [
  { id: "split", label: "split" },
  { id: "wipe", label: "wipe" },
  { id: "onion", label: "onion" },
];

export function CompareOverlay() {
  const view = useHistoryView();
  const open = useStore((s) => s.compareOpen);
  const aId = useStore((s) => s.compareA);
  const bId = useStore((s) => s.compareB);
  const mode = useStore((s) => s.compareMode);
  const setCompareMode = useStore((s) => s.setCompareMode);
  const closeCompare = useStore((s) => s.closeCompare);

  const [split, setSplit] = useState(50);
  const [onion, setOnion] = useState(50);

  // Resolve A / B against the live view; fall back to head when the
  // stored id is stale (e.g. compare was opened before any real
  // commits existed yet, or after a truncate dropped the referenced
  // commit).
  const A = useMemo(
    () => view.commitById[aId] ?? (view.headCommitId ? view.commitById[view.headCommitId] : undefined),
    [view, aId],
  );
  const B = useMemo(
    () => view.commitById[bId] ?? (view.headCommitId ? view.commitById[view.headCommitId] : undefined),
    [view, bId],
  );

  const aThumb = useMemo(
    () => (A ? captureThumbnail(A.id, { branchId: A.branchId, tick: A.tick }) : null),
    [A?.id, A?.branchId, A?.tick],
  );
  const bThumb = useMemo(
    () => (B ? captureThumbnail(B.id, { branchId: B.branchId, tick: B.tick }) : null),
    [B?.id, B?.branchId, B?.tick],
  );

  if (!open) return null;
  if (!A || !B) return null;
  const Abr = view.branchById[A.branchId];
  const Bbr = view.branchById[B.branchId];
  if (!Abr || !Bbr) return null;

  const onDividerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const surface = e.currentTarget.parentElement;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = ev.clientX - rect.left;
      setSplit(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener(
      "mouseup",
      () => window.removeEventListener("mousemove", move),
      { once: true },
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        pointerEvents: "none",
      }}
    >
      {/* dim layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          pointerEvents: "auto",
        }}
        onClick={closeCompare}
      />

      {/* comparator surface */}
      <div
        style={{
          position: "absolute",
          inset: "80px 320px 280px 320px",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--border-2)",
          pointerEvents: "auto",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.8)",
          background: "#000",
        }}
      >
        <ErrorBoundary
          label="CompareOverlay"
          fallback={
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--fg-faint)",
                fontFamily: "Geist Mono",
                fontSize: "var(--text-sm)",
                letterSpacing: "0.1em",
              }}
            >
              ··· compare unavailable
            </div>
          }
        >
        {/* base = A */}
        <ThumbLayer
          url={aThumb}
          dim={Abr.status === "abandoned"}
          style={{ position: "absolute", inset: 0 }}
        />

        {mode === "split" && (
          // B occupies the full surface (aligning with A pixel-for-pixel),
          // clipped to the right portion of the divider. clip-path
          // doesn't shift the image inside — it just cuts away what's
          // outside the visible region, so the maze stays centered like A.
          <ThumbLayer
            url={bThumb}
            dim={Bbr.status === "abandoned"}
            style={{
              position: "absolute",
              inset: 0,
              clipPath: `inset(0 0 0 ${split}%)`,
            }}
          />
        )}
        {mode === "wipe" && (
          <ThumbLayer
            url={bThumb}
            dim={Bbr.status === "abandoned"}
            style={{
              position: "absolute",
              inset: 0,
              clipPath: `inset(0 ${100 - split}% 0 0)`,
            }}
          />
        )}
        {mode === "onion" && (
          <ThumbLayer
            url={bThumb}
            dim={Bbr.status === "abandoned"}
            style={{
              position: "absolute",
              inset: 0,
              opacity: onion / 100,
              mixBlendMode: "screen",
            }}
          />
        )}
        </ErrorBoundary>

        {/* corner tags */}
        <Tag style={{ top: 10, left: 10 }} branch={Abr} commit={A} side="A" />
        <Tag
          style={{ top: 10, right: 10 }}
          branch={Bbr}
          commit={B}
          side="B"
          right
        />

        {/* split / wipe handle */}
        {(mode === "split" || mode === "wipe") && (
          <div
            onMouseDown={onDividerMouseDown}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `calc(${split}% - 1px)`,
              width: 2,
              background: "rgba(255,255,255,0.85)",
              cursor: "ew-resize",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "var(--panel-3)",
                border: "1px solid var(--border-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--fg)",
                fontFamily: "Geist Mono",
                fontSize: "var(--text-2xs)",
              }}
            >
              ‹›
            </div>
          </div>
        )}
      </div>

      {/* mode picker */}
      <div
        className="glass-heavy"
        style={{
          position: "absolute",
          left: "50%",
          top: 24,
          transform: "translateX(-50%)",
          borderRadius: 10,
          padding: 4,
          pointerEvents: "auto",
          display: "flex",
          gap: 2,
          alignItems: "center",
        }}
      >
        <div className="px-2 font-mono text-[length:var(--text-xs)] uppercase tracking-widest text-fg-dim">
          compare
        </div>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setCompareMode(m.id)}
            className="btn"
            style={{
              background: mode === m.id ? "var(--accent-tint-2)" : "transparent",
              borderColor: mode === m.id ? "var(--accent-edge)" : "transparent",
              color: mode === m.id ? "var(--accent)" : "var(--fg-muted)",
            }}
          >
            {m.label}
          </button>
        ))}
        {mode === "onion" && (
          <div className="ml-2 mr-1 flex items-center gap-2">
            <span className="font-mono text-[length:var(--text-xs)] uppercase tracking-widest text-fg-dim">
              opacity
            </span>
            <input
              type="range"
              className="rng"
              style={{ width: 90, ["--val" as string]: `${onion}%` }}
              min={0}
              max={100}
              value={onion}
              onChange={(e) => setOnion(parseInt(e.target.value, 10))}
            />
            <span
              className="font-mono text-[length:var(--text-xs)]"
              style={{ minWidth: 28 }}
            >
              {onion}%
            </span>
          </div>
        )}
        <div className="mx-1 h-5 w-px" style={{ background: "var(--border)" }} />
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={closeCompare}
          aria-label="Close compare"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

function ThumbLayer({
  url,
  dim,
  style,
}: {
  url: string | null;
  dim: boolean;
  style: React.CSSProperties;
}) {
  if (!url) {
    return (
      <div
        style={{
          ...style,
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
    );
  }
  return (
    <div
      style={{
        ...style,
        backgroundImage: `url(${url})`,
        backgroundSize: "contain",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#000",
        opacity: dim ? 0.6 : 1,
        imageRendering: "pixelated",
      }}
    />
  );
}

type TagProps = {
  style: React.CSSProperties;
  branch: Branch;
  commit: Commit;
  side: "A" | "B";
  right?: boolean;
};

function Tag({ style, branch, commit, side, right }: TagProps) {
  return (
    <div
      style={{
        position: "absolute",
        ...style,
        padding: "6px 10px",
        borderRadius: 6,
        // Solid dark backplate — the comparator surface sits on a dim
        // backdrop, so a translucent glass tier washes out. Add a soft
        // shadow so the tag reads off the maze instead of blending into
        // adjacent walls.
        background: "rgba(8, 8, 10, 0.92)",
        border: "1px solid var(--border-3)",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.5)",
        fontFamily: "Geist Mono",
        fontSize: "var(--text-sm)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexDirection: right ? "row-reverse" : "row",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: laneColorForStatus(branch.status),
        }}
      />
      <span style={{ color: "var(--fg-muted)" }}>{side} ·</span>
      <span style={{ color: "var(--fg)", fontWeight: 600 }}>{branch.name}</span>
      <span style={{ color: "var(--fg-muted)" }}>{hashFmt(commit.hash)}</span>
      <span style={{ color: "var(--fg-muted)" }}>{tickFmt(commit.tick)}</span>
    </div>
  );
}
