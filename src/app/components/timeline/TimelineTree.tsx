/* Spec §14 — BTTF timeline-tree, SVG-based.
   Placement comes from the pure `layoutHistory` core (lib/historyLayout.ts);
   this component is the *chrome paint + interaction adapter* over its output.
   Horizontal (left-right): main axis = ticks, cross axis = lanes. Two cursors:
   playhead (amber, live) + scrub (dashed, preview). A future canvas HUD
   adapter consumes the same HistoryViewState with a vertical orientation. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { session } from "@/app/session";
import type { HistoryView } from "@/lib/buildHistoryView";
import type { CommitGlyph } from "@/lenses/types";
import {
  BRANCH_CURVE_OPACITY,
  FORK_GLYPH_OPACITY,
  LABEL_GUTTER,
  LANE_HEIGHT,
  MIN_TICK_PX,
  NODE_R,
  NODE_R_ACTIVE,
  NODE_R_HEAD,
  RIGHT_PAD,
  TICK_AXIS_HEIGHT,
  TOP_PAD,
  computeColumnRange,
  followHeadPanColumn,
  laneY,
  tickToColumn,
  totalHeightFor,
} from "@/lib/tree";
import { layoutHistory, type PlacedNode } from "@/lib/historyLayout";
import type { Params } from "@/lib/types";
import { laneColorForStatus } from "@/lib/laneColor";
import { hashFmt, tickFmt } from "@/lib/tickFmt";
import { useStore } from "@/app/store";

// 10×10 viewbox, upward arrow centered at (5, 5). The arrowhead has a
// short stem so direction reads at small sizes (vs a bare triangle that
// looks the same as a triangle pointing any direction in the periphery).
const ARROW_PATH = "M 5 1 L 8.6 4.6 L 6.5 4.6 L 6.5 9 L 3.5 9 L 3.5 4.6 L 1.4 4.6 Z";
const ARROW_ROTATION: Record<"up" | "right" | "down" | "left", number> = {
  up: 0,
  right: 90,
  down: 180,
  left: 270,
};

type Props = {
  width: number;
  view: HistoryView;
};

export function TimelineTree({ width, view }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const {
    branches,
    commitById,
    branchById,
    maxHeadTick,
    columnTicks,
    lanesCount,
    headCommitId,
  } = view;

  const playheadTick = useStore((s) => s.playheadTick);
  const setPlayheadTick = useStore((s) => s.setPlayheadTick);
  const selectedCommitId = useStore((s) => s.selectedCommitId);
  const setSelectedCommit = useStore((s) => s.setSelectedCommit);
  const openPreview = useStore((s) => s.openPreview);
  const hoveredCommitId = useStore((s) => s.hoveredCommitId);
  const setHoveredCommit = useStore((s) => s.setHoveredCommit);
  const scrubTick = useStore((s) => s.scrubTick);
  const setScrubTick = useStore((s) => s.setScrubTick);
  const timelineStrategy = useStore((s) => s.timelineStrategy);
  const fit = timelineStrategy === "fit";

  const [draggingPlayhead, setDraggingPlayhead] = useState(false);

  // The timeline is *commit-indexed*: each commit-bearing tick occupies
  // one column, ticks in between interpolate. `panColumn` is the column
  // index at the left edge of the visible window. `autoFollow` keeps
  // the head's column near the right side; turned off when the user
  // drags, turned back on when they pan back to the head.
  const [panColumn, setPanColumn] = useState(0);
  const [autoFollow, setAutoFollow] = useState(true);

  const tickToColumnLocal = useCallback(
    (tick: number) => tickToColumn(tick, columnTicks),
    [columnTicks],
  );

  const maxHeadColumn = tickToColumnLocal(maxHeadTick);
  const playheadColumn = tickToColumnLocal(playheadTick);
  const targetPanColumn = followHeadPanColumn(
    width,
    maxHeadColumn,
    playheadColumn,
  );
  const effectivePanColumn = autoFollow ? targetPanColumn : panColumn;

  // "fit" maps the whole lineage into the width (no pan); "none" windows at
  // MIN_TICK_PX with pan/auto-follow. Interaction (xToTick) reads the same
  // range, so scrub/playhead stay correct in both modes.
  const columnRange = useMemo<[number, number]>(
    () =>
      fit
        ? [0, Math.max(0, columnTicks.length - 1)]
        : computeColumnRange(width, effectivePanColumn),
    [fit, columnTicks.length, width, effectivePanColumn],
  );

  const totalHeight = totalHeightFor(lanesCount);

  // Live, leak-free lane tone (status from the live view, not the fixture
  // tree). Passed into the layout for edges/lanes and reused here for nodes.
  const laneTone = useCallback(
    (id: string) => laneColorForStatus(branchById[id]?.status ?? "alive"),
    [branchById],
  );

  // Clump type key — the lens glyph identity. Folds whose members all share a
  // key render in the lens vocabulary (count + glyph); the layout stays
  // glyph-agnostic and gets this injected (same pattern as laneTone).
  const clumpKey = useCallback((params: Params): string => {
    const lens = session.mounted_lens;
    if (!lens) return "?";
    const g = lens.commitGlyph(params);
    switch (g.kind) {
      case "arrow":
        return `arrow:${g.dir}`;
      case "char":
        return `char:${g.char}`;
      case "disc":
        return `disc:${g.color}`;
      case "image":
        return `image:${g.src}`;
      case "svg":
        return `svg:${g.path}`;
      default:
        return g.kind;
    }
  }, []);

  // The pure layout: HistoryView + viewport → placed ViewState. Memoized on
  // everything that moves a pixel.
  const vs = useMemo(
    () =>
      layoutHistory(view, {
        width,
        columnRange,
        orientation: "left-right",
        strategy: timelineStrategy,
        laneColor: laneTone,
        clumpKey,
        cursors: { playheadTick, scrubTick, headCommitId },
      }),
    [view, width, columnRange, timelineStrategy, laneTone, clumpKey, playheadTick, scrubTick, headCommitId],
  );

  const baselineEdges = vs.edges.filter((e) => e.kind === "baseline");
  const curveEdges = vs.edges.filter((e) => e.kind === "branch-curve");
  const forkNodes = vs.nodes.filter((n) => n.kind === "fork-echo");
  const foldNodes = vs.nodes.filter((n) => n.kind === "fold");
  const commitNodes = vs.nodes.filter((n) => n.kind === "commit");
  const commitNodeById = useMemo(() => {
    const m: Record<string, PlacedNode> = {};
    for (const n of commitNodes) m[n.id] = n;
    return m;
  }, [commitNodes]);

  const playheadCursor = vs.cursors.find((c) => c.kind === "playhead");
  const scrubCursor = vs.cursors.find((c) => c.kind === "scrub");
  const playheadX = playheadCursor?.a.x ?? LABEL_GUTTER;
  const scrubX = scrubCursor?.a.x ?? null;

  // Middle-mouse drag = pan the viewport. Matches the lens-canvas pan
  // gesture (`src/web/pan.ts`). Pan deltas are converted from px to
  // *columns* via MIN_TICK_PX — drag right reveals earlier history.
  const [panDrag, setPanDrag] = useState<
    { startClientX: number; startPanColumn: number } | null
  >(null);

  // Re-engage auto-follow once the user has *released* a pan at the
  // right edge. Skipped while a drag is in progress because panColumn
  // starts equal to targetPanColumn and would re-engage instantly.
  useEffect(() => {
    if (autoFollow || panDrag) return;
    if (panColumn >= targetPanColumn) setAutoFollow(true);
  }, [panColumn, targetPanColumn, autoFollow, panDrag]);

  // External recenter — the status-line button bumps a token; on each
  // bump we drop any user pan and re-engage auto-follow.
  const recenterToken = useStore((s) => s.timelineRecenterToken);
  useEffect(() => {
    if (recenterToken === 0) return;
    setPanDrag(null);
    setAutoFollow(true);
  }, [recenterToken]);

  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    setAutoFollow(false);
    setPanColumn(effectivePanColumn);
    setPanDrag({
      startClientX: e.clientX,
      startPanColumn: effectivePanColumn,
    });
  };

  useEffect(() => {
    if (!panDrag) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - panDrag.startClientX;
      const dc = -dx / MIN_TICK_PX;
      const next = panDrag.startPanColumn + dc;
      // Clamp: never before column 0, never past the head — going
      // beyond would just scroll empty space.
      setPanColumn(Math.max(0, Math.min(targetPanColumn, next)));
    };
    const onUp = () => setPanDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panDrag, targetPanColumn]);

  const xFromMouse = useCallback((e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return e.clientX - rect.left;
  }, []);

  const onSvgMove = (e: React.MouseEvent) => {
    if (panDrag) return; // suppress scrub cursor while panning
    const x = xFromMouse(e);
    if (x < LABEL_GUTTER - 8) {
      setScrubTick(null);
      return;
    }
    const t = vs.hitTestTick(x, 0);
    setScrubTick(t);
    if (draggingPlayhead) setPlayheadTick(t);
  };
  const onSvgLeave = () => setScrubTick(null);

  const onAxisDown = (e: React.MouseEvent) => {
    const x = xFromMouse(e);
    if (x < LABEL_GUTTER) return;
    setDraggingPlayhead(true);
    setPlayheadTick(vs.hitTestTick(x, 0));
  };

  useEffect(() => {
    if (!draggingPlayhead) return;
    const up = () => setDraggingPlayhead(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [draggingPlayhead]);

  const hoveredCommit = hoveredCommitId
    ? commitById[hoveredCommitId]
    : undefined;

  const lanesHeight = lanesCount * LANE_HEIGHT;

  // Clip-rect bounds — everything that depends on the tick window draws
  // inside this rectangle. The label gutter and tooltips live outside it
  // so they're never trimmed.
  const clipX = LABEL_GUTTER - 8;
  const clipW = Math.max(0, width - clipX - RIGHT_PAD + 8);
  const clipY = TOP_PAD;
  const clipH = TICK_AXIS_HEIGHT + lanesHeight;
  const clipId = "timeline-tree-viewport";

  return (
    <svg
      ref={svgRef}
      width={width}
      height={totalHeight}
      style={{
        display: "block",
        userSelect: "none",
        cursor: panDrag ? "grabbing" : "default",
      }}
      onMouseMove={onSvgMove}
      onMouseLeave={onSvgLeave}
      onMouseDown={onSvgMouseDown}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onContextMenu={(e) => {
        if (panDrag) e.preventDefault();
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={clipX} y={clipY} width={clipW} height={clipH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
      {/* Axis drag region */}
      <rect
        x={LABEL_GUTTER - 6}
        y={TOP_PAD - 2}
        width={width - LABEL_GUTTER - RIGHT_PAD + 12}
        height={TICK_AXIS_HEIGHT}
        fill="transparent"
        style={{ cursor: "ew-resize" }}
        onMouseDown={onAxisDown}
      />

      {/* Branch baselines — backbone of each lane */}
      {baselineEdges.map((bl) => (
        <line
          key={`bl-${bl.id}`}
          x1={bl.a.x}
          x2={bl.b.x}
          y1={bl.a.y}
          y2={bl.b.y}
          stroke={bl.color}
          strokeWidth={bl.width}
          strokeLinecap="round"
          opacity={bl.opacity}
        />
      ))}

      {/* Branch-off curves — parent commit → child fork */}
      {curveEdges.map((c) => (
        <path
          key={c.id}
          d={`M ${c.from.x} ${c.from.y} C ${c.c1.x} ${c.c1.y}, ${c.c2.x} ${c.c2.y}, ${c.to.x} ${c.to.y}`}
          fill="none"
          stroke={c.color}
          strokeWidth={1.25}
          strokeLinecap="round"
          opacity={BRANCH_CURVE_OPACITY}
        />
      ))}

      {/* Inherited fork glyphs — faded echo of the parent move */}
      {session.mounted_lens &&
        forkNodes.map((f) => {
          if (!f.params) return null;
          const glyph = session.mounted_lens!.commitGlyph(f.params);
          const { x, y } = f.at;
          return (
            <g key={f.id} opacity={FORK_GLYPH_OPACITY} pointerEvents="none">
              {glyph.kind === "arrow" && (
                <>
                  <circle cx={x} cy={y} r={7} fill={glyph.color} />
                  <path
                    d={ARROW_PATH}
                    fill="#ffffff"
                    transform={`translate(${x}, ${y}) rotate(${ARROW_ROTATION[glyph.dir]}) translate(-5, -5)`}
                  />
                </>
              )}
              {glyph.kind === "disc" && (
                <circle cx={x} cy={y} r={7} fill={glyph.color} />
              )}
              {glyph.kind === "char" && (
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fontFamily="Geist Mono"
                  fontWeight={600}
                  fill="var(--fg-muted)"
                >
                  {glyph.char}
                </text>
              )}
              {glyph.kind === "circle" && (
                <circle cx={x} cy={y} r={NODE_R} fill="var(--fg-muted)" />
              )}
              {glyph.kind === "image" && (
                <image
                  href={glyph.src}
                  x={x - 7}
                  y={y - 7}
                  width={14}
                  height={14}
                  clipPath="circle(7px at 7px 7px)"
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
            </g>
          );
        })}

      {/* Fold glyphs — coalesced runs of quiet commits. A lane-colored
          capsule with the folded count. When the whole run shares one glyph
          (homogeneous), it renders in the lens vocabulary: `count + glyph`
          (e.g. `4 →` for four same-direction moves). */}
      {foldNodes.map((f) => {
        const { x, y } = f.at;
        const label = String(f.count ?? 0);
        const glyph: CommitGlyph | null =
          f.homogeneous && f.params && session.mounted_lens
            ? session.mounted_lens.commitGlyph(f.params)
            : null;
        const stroke = laneTone(f.branchId);
        const countW = label.length * 5.6;

        if (!glyph) {
          // Heterogeneous (or no lens) — neutral count capsule.
          const w = 11 + countW;
          return (
            <g key={f.id} pointerEvents="none">
              <rect
                x={x - w / 2}
                y={y - 7}
                width={w}
                height={14}
                rx={7}
                ry={7}
                fill="var(--pill-stronger)"
                stroke={stroke}
                strokeWidth={1}
                opacity={0.95}
              />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Geist Mono"
                fontSize={9}
                fill="var(--fg-muted)"
              >
                {label}
              </text>
            </g>
          );
        }

        // Vocabulary capsule: [ count · icon ].
        const iconR = 6;
        const padL = 6;
        const gap = 4;
        const padR = 5;
        const w = padL + countW + gap + iconR * 2 + padR;
        const left = x - w / 2;
        const countX = left + padL;
        const iconCx = left + padL + countW + gap + iconR;
        return (
          <g key={f.id} pointerEvents="none">
            <rect
              x={left}
              y={y - 8}
              width={w}
              height={16}
              rx={8}
              ry={8}
              fill="var(--pill-stronger)"
              stroke={stroke}
              strokeWidth={1}
              opacity={0.95}
            />
            <text
              x={countX}
              y={y}
              textAnchor="start"
              dominantBaseline="central"
              fontFamily="Geist Mono"
              fontSize={9.5}
              fontWeight={600}
              fill="var(--fg-muted)"
            >
              {label}
            </text>
            {glyph.kind === "arrow" && (
              <>
                <circle cx={iconCx} cy={y} r={iconR} fill={glyph.color} />
                <path
                  d={ARROW_PATH}
                  fill="#ffffff"
                  transform={`translate(${iconCx}, ${y}) rotate(${ARROW_ROTATION[glyph.dir]}) scale(0.85) translate(-5, -5)`}
                />
              </>
            )}
            {glyph.kind === "disc" && (
              <circle cx={iconCx} cy={y} r={iconR} fill={glyph.color} />
            )}
            {glyph.kind === "char" && (
              <text
                x={iconCx}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontFamily="Geist Mono"
                fontWeight={600}
                fill={stroke}
              >
                {glyph.char}
              </text>
            )}
            {(glyph.kind === "circle" || glyph.kind === "svg" || glyph.kind === "image") && (
              <circle cx={iconCx} cy={y} r={iconR - 1} fill={stroke} />
            )}
          </g>
        );
      })}

      {/* Commit nodes */}
      {commitNodes.map((node) => {
        const b = branchById[node.branchId];
        if (!b) return null;
        const { x, y } = node.at;
        const isHead = !!node.isHead;
        const isSelected = node.id === selectedCommitId;
        const isHover = node.id === hoveredCommitId;
        const r = isHead
          ? NODE_R_HEAD
          : b.status === "active"
            ? NODE_R_ACTIVE
            : NODE_R;
        const fill = laneTone(b.id);
        const nodeOpacity = b.status === "abandoned" ? 0.55 : 1;
        const glyph: CommitGlyph =
          session.mounted_lens && node.params
            ? session.mounted_lens.commitGlyph(node.params)
            : { kind: "circle" };
        const glyphColor = isHead ? "var(--accent)" : fill;
        return (
          <g
            key={node.id}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedCommit(node.id);
              const rect = svgRef.current?.getBoundingClientRect();
              if (rect) {
                openPreview(node.id, {
                  x: rect.left + x,
                  y: rect.top + y,
                });
              }
            }}
            onMouseEnter={() => setHoveredCommit(node.id)}
            onMouseLeave={() => setHoveredCommit(null)}
          >
            <circle cx={x} cy={y} r={11} fill="transparent" />
            {isSelected && (
              <circle
                cx={x}
                cy={y}
                r={r + 4}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                opacity={0.9}
              />
            )}
            {isHover && !isSelected && (
              <circle
                cx={x}
                cy={y}
                r={r + 3}
                fill="none"
                stroke="var(--fg-muted)"
                strokeWidth={1}
              />
            )}
            {glyph.kind === "circle" && (
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={isHead ? "var(--accent)" : fill}
                stroke={isHead ? "var(--accent-edge)" : "var(--node-stroke)"}
                strokeWidth={isHead ? 3 : 0.5}
                opacity={nodeOpacity}
              />
            )}
            {glyph.kind === "char" && (
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={isHead ? 15 : 12}
                fontFamily="Geist Mono"
                fontWeight={isHead ? 700 : 600}
                fill={glyphColor}
                opacity={nodeOpacity}
                style={{ userSelect: "none" }}
              >
                {glyph.char}
              </text>
            )}
            {glyph.kind === "arrow" && (
              <g opacity={nodeOpacity}>
                <circle
                  cx={x}
                  cy={y}
                  r={isHead ? 8.5 : 7}
                  fill={glyph.color}
                  stroke={isHead ? "var(--accent-edge)" : "var(--node-stroke)"}
                  strokeWidth={isHead ? 3 : 0.5}
                />
                <path
                  d={ARROW_PATH}
                  fill="#ffffff"
                  transform={`translate(${x}, ${y}) rotate(${ARROW_ROTATION[glyph.dir]}) translate(-5, -5)`}
                />
              </g>
            )}
            {glyph.kind === "disc" && (
              <circle
                cx={x}
                cy={y}
                r={isHead ? 8.5 : 7}
                fill={glyph.color}
                stroke={isHead ? "var(--accent-edge)" : "var(--node-stroke)"}
                strokeWidth={isHead ? 3 : 0.5}
                opacity={nodeOpacity}
              />
            )}
            {glyph.kind === "svg" && (
              <g
                transform={`translate(${x}, ${y})${
                  glyph.rotation ? ` rotate(${glyph.rotation})` : ""
                } scale(${isHead ? 0.8 : 0.6})`}
              >
                <path
                  d={glyph.path}
                  fill={glyphColor}
                  opacity={nodeOpacity}
                  transform="translate(-12, -12)"
                />
              </g>
            )}
            {glyph.kind === "image" && (() => {
              const rr = isHead ? 8.5 : 7;
              const imgClipId = `glyph-clip-${node.id}`;
              return (
                <g opacity={nodeOpacity}>
                  <defs>
                    <clipPath id={imgClipId}>
                      <circle cx={x} cy={y} r={rr} />
                    </clipPath>
                  </defs>
                  <image
                    href={glyph.src}
                    x={x - rr}
                    y={y - rr}
                    width={rr * 2}
                    height={rr * 2}
                    clipPath={`url(#${imgClipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={rr}
                    fill="none"
                    stroke={isHead ? "var(--accent-edge)" : "var(--node-stroke)"}
                    strokeWidth={isHead ? 3 : 0.5}
                  />
                </g>
              );
            })()}
            {isHead && (
              <text
                x={x}
                y={y - 14}
                textAnchor="middle"
                fontFamily="Geist Mono"
                fontSize="9"
                fontWeight="600"
                fill="var(--accent)"
                letterSpacing="0.06em"
              >
                HEAD
              </text>
            )}
          </g>
        );
      })}

      {/* Scrub cursor */}
      {scrubX !== null && scrubTick !== null && (
        <g pointerEvents="none">
          <line
            x1={scrubX}
            x2={scrubX}
            y1={TOP_PAD + 4}
            y2={TOP_PAD + TICK_AXIS_HEIGHT + lanesHeight - 2}
            stroke="var(--fg)"
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <g transform={`translate(${scrubX}, ${TOP_PAD + 6})`}>
            <rect
              x={-26}
              y={-2}
              width={52}
              height={13}
              rx={2}
              ry={2}
              fill="var(--pill-stronger)"
              stroke="var(--border-3)"
              strokeWidth={1}
            />
            <text
              x={0}
              y={8}
              textAnchor="middle"
              fontFamily="Geist Mono"
              fontSize="9"
              fill="var(--fg)"
              letterSpacing="0.04em"
            >
              {tickFmt(scrubTick)}
            </text>
          </g>
        </g>
      )}

      {/* Playhead */}
      <g pointerEvents="none">
        <line
          x1={playheadX}
          x2={playheadX}
          y1={TOP_PAD + 4}
          y2={TOP_PAD + TICK_AXIS_HEIGHT + lanesHeight - 2}
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
        <g transform={`translate(${playheadX}, ${TOP_PAD + 6})`}>
          <path d="M -5 -2 L 5 -2 L 0 6 Z" fill="var(--accent)" />
          <rect
            x={-28}
            y={6}
            width={56}
            height={13}
            rx={2}
            ry={2}
            fill="var(--accent)"
          />
          <text
            x={0}
            y={16}
            textAnchor="middle"
            fontFamily="Geist Mono"
            fontSize="9.5"
            fontWeight="600"
            fill="var(--accent-text)"
            letterSpacing="0.04em"
          >
            {tickFmt(playheadTick)}
          </text>
        </g>
      </g>

      </g>

      {/* Sticky gutter (branch labels) — drawn outside the viewport clip. */}
      <rect
        x={0}
        y={TOP_PAD}
        width={LABEL_GUTTER - 8}
        height={TICK_AXIS_HEIGHT + lanesHeight}
        fill="var(--gutter-bg)"
      />
      {branches.map((b) => {
        const y = laneY(b.lane);
        const tone = laneTone(b.id);
        const isActive = b.status === "active";
        return (
          <g key={`lbl-${b.id}`} opacity={b.status === "abandoned" ? 0.7 : 1}>
            <circle
              cx={14}
              cy={y}
              r={3}
              fill={tone}
              stroke={isActive ? "var(--accent-edge)" : "var(--node-stroke)"}
              strokeWidth={isActive ? 2 : 0.5}
            />
            <text
              x={26}
              y={y + 3.5}
              fontFamily="Geist Mono"
              fontSize="11"
              fontWeight={isActive ? 600 : 500}
              fill={isActive ? "var(--fg)" : "var(--fg-muted)"}
              letterSpacing="0.02em"
            >
              {b.name}
            </text>
            <text
              x={LABEL_GUTTER - 16}
              y={y + 3.5}
              textAnchor="end"
              fontFamily="Geist Mono"
              fontSize="9"
              fill={isActive ? "var(--accent)" : "var(--fg-faint)"}
              letterSpacing="0.06em"
            >
              {b.status}
            </text>
          </g>
        );
      })}

      {/* Hover commit tooltip */}
      {hoveredCommit && hoveredCommit.id !== selectedCommitId && (
        <g pointerEvents="none">
          {(() => {
            const node = commitNodeById[hoveredCommit.id];
            if (!node) return null;
            const { x, y } = node.at;
            return (
              <g transform={`translate(${x + 12}, ${y - 22})`}>
                <rect
                  x={0}
                  y={0}
                  width={108}
                  height={18}
                  rx={3}
                  ry={3}
                  fill="var(--pill-stronger)"
                  stroke="var(--border-3)"
                />
                <text
                  x={6}
                  y={12}
                  fontFamily="Geist Mono"
                  fontSize="9.5"
                  fill="var(--fg)"
                >
                  {hashFmt(hoveredCommit.hash)} · {tickFmt(hoveredCommit.tick)}
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}
