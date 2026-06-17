import { describe, expect, test } from "vitest";
import {
  layoutHistory,
  type LayoutViewport,
} from "../src/lib/historyLayout";
import type { HistoryView } from "../src/app/lib/historyView";
import {
  LABEL_GUTTER,
  RIGHT_PAD,
  TOP_PAD,
  TICK_AXIS_HEIGHT,
  LANE_HEIGHT,
} from "../src/lib/tree";
import type { Branch, Commit } from "../src/lib/types";

// A synthetic two-branch history: main on lane 0 (ticks 0,1,2), a child
// forked at tick 1 on lane 1 (ticks 2,3). Commit ticks are exactly the
// column ticks, so tickToColumn(t) === its index — placement math is
// checkable by hand.
function fixtureView(): HistoryView {
  const branches: Branch[] = [
    {
      id: "main",
      name: "main",
      lane: 0,
      status: "active",
      parentBranch: null,
      parentCommit: null,
      startTick: 0,
      headTick: 2,
    },
    {
      id: "b1",
      name: "b1",
      lane: 1,
      status: "alive",
      parentBranch: "main",
      parentCommit: "c-m1",
      startTick: 1,
      headTick: 3,
    },
  ];
  const commits: Commit[] = [
    { id: "c-m0", branchId: "main", tick: 0, hash: "0000000", msg: "", params: { x: 0 } },
    { id: "c-m1", branchId: "main", tick: 1, hash: "0000001", msg: "", params: { x: 1 } },
    { id: "c-m2", branchId: "main", tick: 2, hash: "0000002", msg: "", params: { x: 2 } },
    { id: "c-b2", branchId: "b1", tick: 2, hash: "0000003", msg: "", params: { x: 3 } },
    { id: "c-b3", branchId: "b1", tick: 3, hash: "0000004", msg: "", params: { x: 4 } },
  ];
  const branchById = Object.fromEntries(branches.map((b) => [b.id, b]));
  const commitById = Object.fromEntries(commits.map((c) => [c.id, c]));
  return {
    branches,
    commits,
    branchById,
    commitById,
    maxHeadTick: 3,
    columnTicks: [0, 1, 2, 3],
    lanesCount: 2,
    activeBranchId: "main",
    headCommitId: "c-m2",
  };
}

const WIDTH = 500;
function vp(over: Partial<LayoutViewport> = {}): LayoutViewport {
  return {
    width: WIDTH,
    columnRange: [0, 3],
    orientation: "left-right",
    strategy: "none",
    laneColor: () => "#fff",
    cursors: { playheadTick: 2, scrubTick: null, headCommitId: "c-m2" },
    ...over,
  };
}

const laneY = (lane: number) =>
  TOP_PAD + TICK_AXIS_HEIGHT + LANE_HEIGHT / 2 + lane * LANE_HEIGHT;

describe("layoutHistory", () => {
  test("left-right places commits at the chrome's current pixels", () => {
    const out = layoutHistory(fixtureView(), vp());
    const mainLen = WIDTH - LABEL_GUTTER - RIGHT_PAD; // 312
    const colX = (col: number) => LABEL_GUTTER + (col / 3) * mainLen;

    const m2 = out.nodes.find((n) => n.id === "c-m2")!;
    expect(m2.kind).toBe("commit");
    expect(m2.at.x).toBeCloseTo(colX(2)); // 340
    expect(m2.at.y).toBeCloseTo(laneY(0)); // 57
    expect(m2.isHead).toBe(true);

    const b3 = out.nodes.find((n) => n.id === "c-b3")!;
    expect(b3.at.x).toBeCloseTo(colX(3));
    expect(b3.at.y).toBeCloseTo(laneY(1)); // child lane
    expect(b3.isHead).toBe(false);
  });

  test("a fork-echo is emitted on the child branch at its fork point", () => {
    const out = layoutHistory(fixtureView(), vp());
    const echo = out.nodes.find((n) => n.kind === "fork-echo" && n.branchId === "b1");
    expect(echo).toBeDefined();
    expect(echo!.faded).toBe(true);
    expect(echo!.params).toEqual({ x: 1 }); // the parent commit's payload
  });

  test("playhead cursor spans the full cross extent (vertical line when horizontal)", () => {
    const out = layoutHistory(fixtureView(), vp());
    const ph = out.cursors.find((c) => c.kind === "playhead")!;
    expect(ph.tick).toBe(2);
    expect(ph.a.x).toBeCloseTo(ph.b.x); // same main position → a vertical line
    expect(Math.abs(ph.b.y - ph.a.y)).toBeCloseTo(2 * LANE_HEIGHT); // crossLen
  });

  test("top-down is the same layout with main↔cross swapped", () => {
    const lr = layoutHistory(fixtureView(), vp());
    const td = layoutHistory(fixtureView(), vp({ orientation: "top-down" }));

    const lrM0 = lr.nodes.find((n) => n.id === "c-m0")!;
    const lrM2 = lr.nodes.find((n) => n.id === "c-m2")!;
    const tdM0 = td.nodes.find((n) => n.id === "c-m0")!;
    const tdM2 = td.nodes.find((n) => n.id === "c-m2")!;

    // Horizontal: time advances in x, lanes spread in y.
    expect(lrM2.at.x).toBeGreaterThan(lrM0.at.x);
    // Vertical: time advances in y, lanes spread in x.
    expect(tdM2.at.y).toBeGreaterThan(tdM0.at.y);

    // A main-branch and a child-branch commit at the same tick differ on the
    // cross axis only — y in horizontal, x in vertical.
    const lrB2 = lr.nodes.find((n) => n.id === "c-b2")!;
    const tdB2 = td.nodes.find((n) => n.id === "c-b2")!;
    expect(lrM2.at.y).not.toBeCloseTo(lrB2.at.y);
    expect(lrM2.at.x).toBeCloseTo(lrB2.at.x);
    expect(tdM2.at.x).not.toBeCloseTo(tdB2.at.x);
    expect(tdM2.at.y).toBeCloseTo(tdB2.at.y);

    // The playhead is a horizontal line when vertical (spans x, constant y).
    const ph = td.cursors.find((c) => c.kind === "playhead")!;
    expect(ph.a.y).toBeCloseTo(ph.b.y);
    expect(Math.abs(ph.b.x - ph.a.x)).toBeCloseTo(2 * LANE_HEIGHT);
  });
});

// A single-branch lineage of N commits (ticks 0..N-1), head = the last.
function lineView(n: number): HistoryView {
  const branches: Branch[] = [
    {
      id: "main",
      name: "main",
      lane: 0,
      status: "active",
      parentBranch: null,
      parentCommit: null,
      startTick: 0,
      headTick: n - 1,
    },
  ];
  const commits: Commit[] = Array.from({ length: n }, (_, i) => ({
    id: `c-${i}`,
    branchId: "main",
    tick: i,
    hash: String(i).padStart(7, "0"),
    msg: "",
    params: { i },
  }));
  return {
    branches,
    commits,
    branchById: { main: branches[0]! },
    commitById: Object.fromEntries(commits.map((c) => [c.id, c])),
    maxHeadTick: n - 1,
    columnTicks: commits.map((c) => c.tick),
    lanesCount: 1,
    activeBranchId: "main",
    headCommitId: `c-${n - 1}`,
  };
}

describe("fit strategy folding", () => {
  // Narrow width so 10 commits across the full domain pack tighter than
  // MIN_NODE_PX and must fold. mainLen = 278 − 132 − 56 = 90 → ~10px spacing.
  const N = 10;
  const fitVp = (): LayoutViewport =>
    vp({ width: 278, columnRange: [0, N - 1], strategy: "fit", cursors: { playheadTick: 0, scrubTick: null, headCommitId: `c-${N - 1}` } });

  test("none keeps every commit; fit folds quiet runs", () => {
    const none = layoutHistory(lineView(N), vp({ columnRange: [0, N - 1] }));
    expect(none.nodes.filter((n) => n.kind === "commit").length).toBe(N);
    expect(none.nodes.filter((n) => n.kind === "fold").length).toBe(0);

    const fit = layoutHistory(lineView(N), fitVp());
    expect(fit.nodes.filter((n) => n.kind === "fold").length).toBeGreaterThan(0);
  });

  test("fit conserves commit count across folds + unfolded nodes", () => {
    const out = layoutHistory(lineView(N), fitVp());
    const singles = out.nodes.filter((n) => n.kind === "commit").length;
    const folded = out.nodes
      .filter((n) => n.kind === "fold")
      .reduce((s, n) => s + (n.count ?? 0), 0);
    expect(singles + folded).toBe(N); // nothing lost or double-counted
  });

  test("fit never folds the head", () => {
    const out = layoutHistory(lineView(N), fitVp());
    const head = out.nodes.find((n) => n.kind === "commit" && n.isHead);
    expect(head).toBeDefined();
    expect(head!.id).toBe(`c-${N - 1}`);
  });

  test("fit spaces rendered elements evenly (position-by-element)", () => {
    const out = layoutHistory(
      lineView(40),
      vp({
        width: 360,
        columnRange: [0, 39],
        strategy: "fit",
        cursors: { playheadTick: 0, scrubTick: null, headCommitId: "c-39" },
      }),
    );
    const xs = out.nodes
      .filter((n) => n.kind === "commit" || n.kind === "fold")
      .map((n) => n.at.x)
      .sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    // Even spacing: every gap is the same slot width (vs. tick-midpoint
    // placement, where a clump left its whole span as dead space).
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
  });
});

describe("explicit geometry box (in-HUD strip)", () => {
  test("top-down + box places a compact vertical strip", () => {
    const out = layoutHistory(
      lineView(10),
      vp({
        orientation: "top-down",
        strategy: "fit",
        columnRange: [0, 9],
        width: 46,
        box: { mainStart: 100, mainLen: 300, crossStart: 200 },
        cursors: { playheadTick: 0, scrubTick: null, headCommitId: "c-9" },
      }),
    );
    const nodes = out.nodes.filter((n) => n.kind === "commit" || n.kind === "fold");
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      // main axis = y, confined to the strip's [mainStart, mainStart+mainLen].
      expect(n.at.y).toBeGreaterThanOrEqual(99);
      expect(n.at.y).toBeLessThanOrEqual(401);
      // cross axis = x, compact near crossStart (single lane).
      expect(n.at.x).toBeGreaterThanOrEqual(200);
      expect(n.at.x).toBeLessThan(240);
    }
    // The head (newest) sits toward the bottom of a top-down strip.
    const head = out.nodes.find((n) => n.kind === "commit" && n.isHead)!;
    const first = out.nodes
      .filter((n) => n.kind === "commit" || n.kind === "fold")
      .reduce((a, b) => (a.at.y <= b.at.y ? a : b));
    expect(head.at.y).toBeGreaterThan(first.at.y);
  });
});

describe("recent strategy + clump-glyph homogeneity", () => {
  const N = 80;
  const recentVp = (over: Partial<LayoutViewport> = {}): LayoutViewport =>
    vp({
      width: 400,
      columnRange: [0, N - 1],
      strategy: "recent",
      cursors: { playheadTick: N - 1, scrubTick: null, headCommitId: `c-${N - 1}` },
      ...over,
    });

  test("recent keeps the newest commits whole and conserves count", () => {
    const out = layoutHistory(lineView(N), recentVp());
    // The newest 20 (RECENT_KEEP) are landmarks → individual commit nodes.
    for (let i = N - 20; i < N; i++) {
      const node = out.nodes.find((n) => n.kind === "commit" && n.id === `c-${i}`);
      expect(node, `c-${i} should be unfolded`).toBeDefined();
    }
    const singles = out.nodes.filter((n) => n.kind === "commit").length;
    const folded = out.nodes
      .filter((n) => n.kind === "fold")
      .reduce((s, n) => s + (n.count ?? 0), 0);
    expect(singles + folded).toBe(N);
  });

  test("recent is a gradient — older clumps are larger than newer ones", () => {
    const folds = layoutHistory(lineView(N), recentVp()).nodes.filter(
      (n) => n.kind === "fold",
    );
    expect(folds.length).toBeGreaterThan(1);
    // Left-right: oldest fold = smallest x, newest fold = largest x.
    const oldest = folds.reduce((a, b) => (a.at.x <= b.at.x ? a : b));
    const newest = folds.reduce((a, b) => (a.at.x >= b.at.x ? a : b));
    expect(oldest.count!).toBeGreaterThanOrEqual(newest.count!);
  });

  test("a same-key run folds homogeneous (lens vocabulary); a mixed run does not", () => {
    const homo = layoutHistory(
      lineView(N),
      recentVp({ clumpKey: () => "same" }),
    ).nodes.filter((n) => n.kind === "fold");
    expect(homo.some((f) => f.homogeneous && f.params)).toBe(true);

    const mixed = layoutHistory(
      lineView(N),
      recentVp({ clumpKey: (p) => String((p as { i: number }).i) }),
    ).nodes.filter((n) => n.kind === "fold");
    expect(mixed.every((f) => !f.homogeneous)).toBe(true);
  });
});
