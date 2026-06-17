/* History layout — the pure, renderer-agnostic core of the history view.
 *
 * Splits "where does everything go" (this file) from "paint it" (the SVG
 * chrome renderer, a future canvas HUD renderer). `layoutHistory` is the
 * history-lens's forward operator: `(HistoryView, viewport) → ViewState`.
 * It is pure — no React, no DOM, no store reads — so the *same* output can
 * feed the chrome timeline, a substrate's in-HUD mini-history, or a test.
 *
 * Two axes, named logically so orientation is just a projection:
 *   - main axis  = time (commit columns). Horizontal in the chrome today.
 *   - cross axis = lanes (branches).
 * `project()` maps logical (mainPx, crossPx) → screen (x, y) per Orientation,
 * so a vertical tree (a substrate HUD) is the identical layout with a
 * different projection — nothing downstream of here knows the difference.
 *
 * App-tier (throwaway / not translated), same as the rest of src/app.
 */

import type { Params, BranchStatus } from "./types";
import {
  LABEL_GUTTER,
  RIGHT_PAD,
  TOP_PAD,
  TICK_AXIS_HEIGHT,
  LANE_HEIGHT,
  tickToColumn,
  columnToTick,
} from "./tree";
import type { HistoryView } from "./buildHistoryView";

export type Orientation = "left-right" | "right-left" | "top-down" | "down-top";

export type Pt = { x: number; y: number };

// A placed visual element on the main (time) axis. `commit` and `fold` are
// the two node kinds the strategy emits; `fork-echo` is the faded parent
// glyph drawn at a branch's fork point. `params` lets the paint adapter
// resolve the lens glyph (the layout stays glyph-agnostic — it only places).
export type PlacedNode = {
  id: string;
  kind: "commit" | "fold" | "fork-echo";
  at: Pt;
  branchId: string;
  // commit + fork-echo: payload for glyph resolution by the paint adapter
  params?: Params;
  // commit:
  tick?: number;
  hash?: string;
  isHead?: boolean;
  // fold:
  count?: number;
  fromTick?: number;
  toTick?: number;
  // fold: every folded commit shares one glyph type (via clumpKey) — so the
  // paint adapter can render the clump in the lens's own vocabulary
  // (count + that glyph, e.g. `4 →`) instead of a neutral count. `params`
  // carries a representative payload to resolve the glyph from.
  homogeneous?: boolean;
  // fork-echo:
  faded?: boolean;
};

// Edges between nodes, pre-projected. A baseline is the branch backbone;
// a branch-curve is the parent→fork connector, with bezier control points
// already projected so the adapter just strokes a cubic (SVG `C` / canvas
// `bezierCurveTo`) and never has to know which way "bend" points.
export type PlacedEdge =
  | {
      kind: "baseline";
      id: string;
      a: Pt;
      b: Pt;
      color: string;
      opacity: number;
      width: number;
    }
  | { kind: "branch-curve"; id: string; from: Pt; c1: Pt; c2: Pt; to: Pt; color: string };

// A cursor (playhead / scrub) is a line perpendicular to the main axis,
// spanning the full cross extent — vertical in horizontal orientations,
// horizontal in vertical ones. Emitted as a projected segment so paint is
// orientation-dumb. `labelAt` anchors the tick chip.
export type PlacedCursor = {
  kind: "playhead" | "scrub";
  a: Pt;
  b: Pt;
  labelAt: Pt;
  tick: number;
};

// Lane (branch) metadata + its cross-axis screen coordinate. Labels are a
// paint-adapter concern (text doesn't rotate; the chrome draws a gutter, a
// HUD may draw ticks or nothing), so the layout only carries the position.
export type PlacedLane = {
  id: string;
  name: string;
  status: BranchStatus;
  color: string;
  crossPos: number;
};

export type HistoryViewState = {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  lanes: PlacedLane[];
  cursors: PlacedCursor[];
  bounds: { width: number; height: number };
  // Inverse of placement: a screen point → the tick under it, honoring the
  // active positioning domain (windowed-time for "none", element-indexed for
  // folding strategies). Interaction (scrub / playhead drag) calls this so it
  // never re-derives the mapping and stays correct under folding + any
  // orientation.
  hitTestTick: (x: number, y: number) => number;
};

// How a fixed pixel budget gets spent on the commit stream.
//   "none"    — every (windowed) commit is a node (the panned view).
//   "fit"     — map the whole lineage into the width; coalesce per-lane runs
//               packed tighter than MIN_NODE_PX into Fold glyphs. Uniform.
//   "recent"  — like fit, but the fold threshold *grows toward the root*
//               (gradient: resolution follows attention, fine near HEAD) and
//               the last RECENT_KEEP commits are preserved unfolded.
//   later     — "by-direction" etc.: same loop, different `mergeable`.
export type FoldStrategy = "none" | "fit" | "recent";

// Minimum on-main-axis spacing between two placed elements before folding.
// ~node diameter + a hair, so unfolded dots never kiss.
const MIN_NODE_PX = 15;
// "recent": how many newest commits are kept whole, and how much wider the
// fold threshold gets at the root vs at HEAD (the gradient slope).
const RECENT_KEEP = 20;
const GRADIENT_MAX_MULT = 8;

// The viewport + interaction state the component owns and passes in. The
// component still computes the column window (pan / auto-follow); the layout
// only places given that window.
export type LayoutViewport = {
  width: number; // container width (CSS px) along the chrome's main axis
  columnRange: [number, number]; // [leftColumn, rightColumn] visible window
  orientation: Orientation;
  strategy: FoldStrategy;
  // Explicit geometry box, for callers that aren't the chrome timeline (e.g. a
  // compact in-HUD strip). Overrides the chrome-constant defaults so a HUD
  // isn't stuck with the 132px label gutter / 30px tick-axis header. The main
  // axis runs `mainLen` px from `mainStart`; lanes start at `crossStart`.
  box?: { mainStart?: number; mainLen?: number; crossStart?: number };
  laneColor: (branchId: string) => string;
  // Optional type key for a commit (resolved by the caller from the lens
  // glyph). Folds whose members all share a key render in the lens vocabulary
  // (count + glyph). Absent ⇒ folds always render as a neutral count.
  clumpKey?: (params: Params) => string;
  cursors: { playheadTick: number; scrubTick: number | null; headCommitId: string | null };
};

// Internal geometry: where each axis starts in screen px and how long it is.
// `left-right` reuses the existing chrome constants so the migrated renderer
// is pixel-identical; the other orientations swap main↔cross.
type Geom = {
  orientation: Orientation;
  mainStart: number;
  mainLen: number;
  crossStart: number;
  crossLen: number;
};

const VIEW_BLEED = 2;

// (mainPx, crossPx) are 0-based offsets along each logical axis. project()
// is the single place orientation enters; everything above produces logical
// offsets and calls this.
function project(mainPx: number, crossPx: number, g: Geom): Pt {
  switch (g.orientation) {
    case "left-right":
      return { x: g.mainStart + mainPx, y: g.crossStart + crossPx };
    case "right-left":
      return { x: g.mainStart + g.mainLen - mainPx, y: g.crossStart + crossPx };
    case "top-down":
      return { x: g.crossStart + crossPx, y: g.mainStart + mainPx };
    case "down-top":
      return { x: g.crossStart + crossPx, y: g.mainStart + g.mainLen - mainPx };
  }
}

// Inverse of the main-axis projection: screen point → main-axis offset.
// Interaction (scrub / playhead drag) uses this, then columnToTick, to turn
// a pointer position back into a tick.
export function unprojectMain(pt: Pt, g: Geom): number {
  switch (g.orientation) {
    case "left-right":
      return pt.x - g.mainStart;
    case "right-left":
      return g.mainStart + g.mainLen - pt.x;
    case "top-down":
      return pt.y - g.mainStart;
    case "down-top":
      return g.mainStart + g.mainLen - pt.y;
  }
}

function laneCrossPx(laneIdx: number): number {
  return LANE_HEIGHT / 2 + laneIdx * LANE_HEIGHT;
}

function totalCrossLen(lanesCount: number): number {
  return lanesCount * LANE_HEIGHT;
}

// Build the geometry box for an orientation. For left-right we reuse the
// chrome's gutter/axis constants verbatim so the migrated renderer matches
// the current pixels exactly; vertical modes start the main axis below the
// (future) header and have no left gutter.
export function makeGeom(
  orientation: Orientation,
  width: number,
  lanesCount: number,
  box?: { mainStart?: number; mainLen?: number; crossStart?: number },
): Geom {
  const crossLen = totalCrossLen(lanesCount);
  if (orientation === "left-right" || orientation === "right-left") {
    return {
      orientation,
      mainStart: box?.mainStart ?? LABEL_GUTTER,
      mainLen: box?.mainLen ?? Math.max(0, width - LABEL_GUTTER - RIGHT_PAD),
      crossStart: box?.crossStart ?? TOP_PAD + TICK_AXIS_HEIGHT,
      crossLen,
    };
  }
  // Vertical: main axis (time) runs down, cross axis (lanes) runs across. A
  // HUD passes an explicit `box` (mainLen = strip height, compact starts); the
  // chrome-constant defaults are only a fallback for the bare `width` case.
  return {
    orientation,
    mainStart: box?.mainStart ?? TOP_PAD,
    mainLen: box?.mainLen ?? Math.max(0, width - TOP_PAD - RIGHT_PAD),
    crossStart: box?.crossStart ?? LABEL_GUTTER,
    crossLen,
  };
}

// Position along the main axis (in px) for a fractional column, given the
// visible window. Mirrors makeColumnToX but returns a 0-based offset (no
// gutter baked in) so project() can place it per orientation.
function columnToMainPx(col: number, columnRange: [number, number], mainLen: number): number {
  const [c0, c1] = columnRange;
  const span = c1 - c0;
  if (span <= 0) return 0;
  return ((col - c0) / span) * mainLen;
}

export function layoutHistory(
  view: HistoryView,
  vp: LayoutViewport,
): HistoryViewState {
  const { branches, commits, branchById, commitById, columnTicks, lanesCount } = view;
  const g = makeGeom(vp.orientation, vp.width, lanesCount, vp.box);
  const [c0, c1] = vp.columnRange;
  const laneOf = (branchId: string): number => branchById[branchId]?.lane ?? 0;
  const headId = vp.cursors.headCommitId;

  // Time-proportional main px over the passed window — used for fold-threshold
  // decisions and view-culling only. Final placement uses `posOf` (below),
  // which for a folding strategy switches to an element-indexed (evenly
  // spaced) domain.
  const colOf = (tick: number) => tickToColumn(tick, columnTicks);
  const rawMainOf = (tick: number) => columnToMainPx(colOf(tick), vp.columnRange, g.mainLen);
  const inView = (tick: number): boolean => {
    const c = colOf(tick);
    return c >= c0 - VIEW_BLEED && c <= c1 + VIEW_BLEED;
  };
  const overlapsView = (a: number, b: number): boolean => {
    const ca = colOf(a);
    const cb = colOf(b);
    return Math.max(ca, cb) >= c0 && Math.min(ca, cb) <= c1;
  };

  // --- 1) Decide elements (singletons + folds) -------------------------------
  // Folding uses time-proportional px (rawMainOf) so a clump represents a real
  // span of cramped commits. The output is the ordered list of *rendered*
  // elements; positioning (step 2) is a separate concern.
  type FoldEl = {
    kind: "fold";
    id: string;
    branchId: string;
    repTick: number;
    count: number;
    fromTick: number;
    toTick: number;
    homogeneous: boolean;
    params?: Params;
  };
  type Element = { kind: "commit"; commit: (typeof commits)[number] } | FoldEl;
  const elements: Element[] = [];

  if (vp.strategy === "none") {
    for (const c of commits) if (inView(c.tick)) elements.push({ kind: "commit", commit: c });
  } else {
    // Per-lane: commits on different branches sit on different cross positions
    // and never collide, so each lane folds independently.
    //   spacingAt — fit: uniform MIN_NODE_PX. recent: grows toward the root
    //               (resolution follows attention; fine near HEAD).
    //   landmark  — fit: the head. recent: head + the newest RECENT_KEEP.
    // A multi-commit run becomes a Fold; if all members share a clumpKey it is
    // `homogeneous` and carries a representative payload (lens-vocabulary glyph).
    const headTick = headId ? (commitById[headId]?.tick ?? 0) : 0;
    const headMainPx = rawMainOf(headTick);
    const recentIds = new Set<string>();
    if (vp.strategy === "recent") {
      const byTickDesc = [...commits].sort((a, b) => b.tick - a.tick);
      for (let i = 0; i < Math.min(RECENT_KEEP, byTickDesc.length); i++) {
        recentIds.add(byTickDesc[i]!.id);
      }
    }
    const spacingAt = (px: number): number => {
      if (vp.strategy !== "recent" || g.mainLen <= 0) return MIN_NODE_PX;
      const frac = Math.min(1, Math.abs(headMainPx - px) / g.mainLen);
      return MIN_NODE_PX * (1 + (GRADIENT_MAX_MULT - 1) * frac);
    };
    const isLandmark = (c: (typeof commits)[number]): boolean =>
      c.id === headId || recentIds.has(c.id);
    const keyOf = (c: (typeof commits)[number]): string | null =>
      vp.clumpKey && c.params ? vp.clumpKey(c.params) : null;

    const byLane = new Map<string, typeof commits>();
    for (const c of commits) {
      if (!inView(c.tick)) continue;
      const arr = byLane.get(c.branchId);
      if (arr) arr.push(c);
      else byLane.set(c.branchId, [c]);
    }
    for (const [branchId, laneCommits] of byLane) {
      const sorted = [...laneCommits].sort((a, b) => rawMainOf(a.tick) - rawMainOf(b.tick));
      let run: typeof commits = [];
      let runStartPx = 0;
      const flush = () => {
        if (run.length === 0) return;
        if (run.length === 1) {
          elements.push({ kind: "commit", commit: run[0]! });
        } else {
          const first = run[0]!;
          const last = run[run.length - 1]!;
          const keys = run.map(keyOf);
          const homogeneous = keys[0] != null && keys.every((k) => k === keys[0]);
          elements.push({
            kind: "fold",
            id: `fold-${branchId}-${first.id}`,
            branchId,
            repTick: (first.tick + last.tick) / 2,
            count: run.length,
            fromTick: first.tick,
            toTick: last.tick,
            homogeneous,
            ...(homogeneous && first.params ? { params: first.params } : {}),
          });
        }
        run = [];
      };
      for (const c of sorted) {
        const px = rawMainOf(c.tick);
        if (isLandmark(c)) {
          flush();
          elements.push({ kind: "commit", commit: c });
          runStartPx = px;
          continue;
        }
        if (run.length > 0 && px - runStartPx < spacingAt(runStartPx)) run.push(c);
        else {
          flush();
          run = [c];
          runStartPx = px;
        }
      }
      flush();
    }
  }

  // --- 2) Position domain ----------------------------------------------------
  // "none": time-proportional over the windowed commit columns (unchanged).
  // folding: element-indexed — each rendered element + each branch endpoint is
  // one evenly-spaced anchor, so a clump and a singleton get equal slots
  // (consistent spacing — the fix for clumps leaving tick-sized gaps). Shared
  // ticks across lanes map to the same slot, so branch alignment survives where
  // lanes coincide; the time axis only "parts away" from even spacing where
  // lanes diverge.
  let domainTicks: number[];
  let domainRange: [number, number];
  if (vp.strategy === "none") {
    domainTicks = columnTicks;
    domainRange = vp.columnRange;
  } else {
    const set = new Set<number>();
    for (const el of elements) set.add(el.kind === "commit" ? el.commit.tick : el.repTick);
    for (const b of branches) {
      set.add(b.startTick);
      set.add(b.headTick);
    }
    domainTicks = [...set].sort((a, b) => a - b);
    domainRange = [0, Math.max(0, domainTicks.length - 1)];
  }
  const posOf = (tick: number): number =>
    columnToMainPx(tickToColumn(tick, domainTicks), domainRange, g.mainLen);
  const place = (tick: number, laneIdx: number): Pt =>
    project(posOf(tick), laneCrossPx(laneIdx), g);

  // --- lanes ---
  const lanes: PlacedLane[] = branches.map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    color: vp.laneColor(b.id),
    crossPos: project(0, laneCrossPx(b.lane), g)[
      g.orientation === "top-down" || g.orientation === "down-top" ? "x" : "y"
    ],
  }));

  // --- edges: baselines + branch-off curves ---
  const edges: PlacedEdge[] = [];
  for (const b of branches) {
    if (!overlapsView(b.startTick, b.headTick)) continue;
    edges.push({
      kind: "baseline",
      id: `bl-${b.id}`,
      a: place(b.startTick, b.lane),
      b: place(b.headTick, b.lane),
      color: vp.laneColor(b.id),
      opacity: b.status === "active" ? 0.55 : b.status === "abandoned" ? 0.18 : 0.35,
      width: b.status === "active" ? 2 : 1,
    });
  }
  for (const b of branches) {
    if (!b.parentBranch || !b.parentCommit) continue;
    const parent = branchById[b.parentBranch];
    const pc = commitById[b.parentCommit];
    if (!parent || !pc) continue;
    if (!overlapsView(pc.tick, b.startTick)) continue;
    const dMain = Math.max(18, Math.abs(posOf(b.startTick) - posOf(pc.tick)) * 0.55);
    edges.push({
      kind: "branch-curve",
      id: `curve-${b.id}`,
      from: place(pc.tick, parent.lane),
      c1: project(posOf(pc.tick) + dMain, laneCrossPx(parent.lane), g),
      c2: project(posOf(b.startTick) - dMain, laneCrossPx(b.lane), g),
      to: place(b.startTick, b.lane),
      color: vp.laneColor(b.id),
    });
  }

  // --- nodes: fork echoes + elements ---
  const nodes: PlacedNode[] = [];
  for (const b of branches) {
    if (!b.parentCommit || !inView(b.startTick)) continue;
    const pc = commitById[b.parentCommit];
    if (!pc?.params) continue;
    nodes.push({
      id: `fork-${b.id}`,
      kind: "fork-echo",
      at: place(b.startTick, b.lane),
      branchId: b.id,
      params: pc.params,
      faded: true,
    });
  }
  for (const el of elements) {
    if (el.kind === "commit") {
      const c = el.commit;
      nodes.push({
        id: c.id,
        kind: "commit",
        at: place(c.tick, laneOf(c.branchId)),
        branchId: c.branchId,
        tick: c.tick,
        hash: c.hash,
        isHead: c.id === headId,
        ...(c.params ? { params: c.params } : {}),
      });
    } else {
      nodes.push({
        id: el.id,
        kind: "fold",
        at: place(el.repTick, laneOf(el.branchId)),
        branchId: el.branchId,
        count: el.count,
        fromTick: el.fromTick,
        toTick: el.toTick,
        ...(el.homogeneous && el.params ? { homogeneous: true, params: el.params } : {}),
      });
    }
  }

  // --- cursors: lines across the full cross extent ---
  const cursors: PlacedCursor[] = [];
  const makeCursor = (kind: "playhead" | "scrub", tick: number): PlacedCursor => {
    const m = posOf(tick);
    const a = project(m, 0, g);
    const b = project(m, g.crossLen, g);
    return { kind, a, b, labelAt: a, tick };
  };
  cursors.push(makeCursor("playhead", vp.cursors.playheadTick));
  if (vp.cursors.scrubTick != null) cursors.push(makeCursor("scrub", vp.cursors.scrubTick));

  // Inverse of placement, over the active domain.
  const mainToCol = (px: number): number =>
    domainRange[0] + (g.mainLen > 0 ? px / g.mainLen : 0) * (domainRange[1] - domainRange[0]);
  const hitTestTick = (x: number, y: number): number =>
    columnToTick(mainToCol(unprojectMain({ x, y }, g)), domainTicks);

  const horizontal = g.orientation === "left-right" || g.orientation === "right-left";
  const bounds = horizontal
    ? { width: vp.width, height: TOP_PAD + TICK_AXIS_HEIGHT + g.crossLen }
    : { width: g.crossStart + g.crossLen + RIGHT_PAD, height: vp.width };

  return { nodes, edges, lanes, cursors, bounds, hitTestTick };
}
