/* buildHistoryView — the **session-free** translation of a `History` struct
 * into the chrome's Branch/Commit view model.
 *
 * Deliberately importing nothing app-global: no `session`, no `useStore`,
 * no React. The only inputs are an explicit `History` and the chrome view
 * types. This is load-bearing: a substrate **lens** that wants an in-canvas
 * history tree calls `buildView(args.history)`, and the lens package must
 * stay importable standalone (tests, the bare host, headless). The sibling
 * `historyView.ts` adds the React hook `useHistoryView`, which *does* read
 * the global `session` — and `session` reaches the substrate registry,
 * which reaches every lens package. Importing the hook's module from a lens
 * would close that cycle (`lens → historyView → session → substrates →
 * lens`) and crash on standalone import. So the rule is: **lenses import
 * `buildView` / `HistoryView` from here, never from `historyView.ts`.**
 */

import {
  historyListBranches,
  type Branch as HBranch,
  type Commit as HCommit,
  type History,
} from "@/history";
import type {
  Branch as ChromeBranch,
  BranchStatus,
  Commit as ChromeCommit,
  Params,
} from "./types";

export type HistoryView = {
  branches: ChromeBranch[];
  commits: ChromeCommit[];
  branchById: Record<string, ChromeBranch>;
  commitById: Record<string, ChromeCommit>;
  maxHeadTick: number;
  // Sorted unique commit ticks — used by the timeline as its column
  // axis. Ticks not in this list collapse to interpolated positions
  // between adjacent commits.
  columnTicks: number[];
  lanesCount: number;
  activeBranchId: string;
  headCommitId: string | null;
};

// Translate a History struct into the chrome's Branch/Commit view shape.
// Takes the history explicitly so it's callable outside React — e.g. a
// substrate lens rendering an in-HUD history off `args.history`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildView(h: History<any, any, any, any>): HistoryView {
  const historyBranches = historyListBranches(h);

  // Lane assignment: stable insertion order. Active branch lifted to the
  // middle lane for visual prominence; everything else takes adjacent
  // lanes around it. For the single-branch case (only "main"), main sits
  // on lane 0.
  const ordered = [...historyBranches];
  const laneByBranchId: Record<string, number> = {};
  for (let i = 0; i < ordered.length; i++) {
    laneByBranchId[ordered[i]!.id] = i;
  }

  const branches: ChromeBranch[] = ordered.map((b) =>
    toChromeBranch(b, h.active, laneByBranchId[b.id]!),
  );

  const commits: ChromeCommit[] = [];
  for (const b of ordered) {
    for (const c of b.commits) {
      commits.push(toChromeCommit(c));
    }
  }
  commits.sort((a, b) => a.tick - b.tick);

  // Resolve each non-root branch's parent-commit pointer: the most recent
  // commit on the parent branch at-or-before fork_tick. Used by the
  // renderer to draw the branch-off curve and the inherited fork glyph.
  for (const b of branches) {
    if (!b.parentBranch) continue;
    const parentBranch = historyBranches.find((x) => x.id === b.parentBranch);
    if (!parentBranch) continue;
    let pickedId: number | null = null;
    for (let i = parentBranch.commits.length - 1; i >= 0; i--) {
      const c = parentBranch.commits[i]!;
      if (c.tick <= b.startTick) {
        pickedId = c.id;
        break;
      }
    }
    if (pickedId !== null) b.parentCommit = `c-${pickedId}`;
  }

  const maxHead = ordered.reduce((m, b) => Math.max(m, b.head_tick), 0);

  const columnTickSet = new Set<number>();
  for (const c of commits) columnTickSet.add(c.tick);
  const columnTicks = Array.from(columnTickSet).sort((a, b) => a - b);

  const branchById: Record<string, ChromeBranch> = {};
  for (const b of branches) branchById[b.id] = b;
  const commitById: Record<string, ChromeCommit> = {};
  for (const c of commits) commitById[c.id] = c;

  const activeBranchCommits = branchById[h.active]
    ? commits.filter((c) => c.branchId === h.active)
    : [];
  const headCommitId =
    activeBranchCommits.length > 0
      ? activeBranchCommits[activeBranchCommits.length - 1]!.id
      : null;

  return {
    branches,
    commits,
    branchById,
    commitById,
    maxHeadTick: maxHead,
    columnTicks,
    lanesCount: Math.max(1, ordered.length),
    activeBranchId: h.active,
    headCommitId,
  };
}

function toChromeBranch<S, I, P>(
  b: HBranch<S, I, P>,
  activeId: string,
  lane: number,
): ChromeBranch {
  const status: BranchStatus = b.id === activeId ? "active" : "alive";
  return {
    id: b.id,
    name: b.id,
    lane,
    status,
    parentBranch: b.parent_branch_id,
    parentCommit: null, // populated below if we can resolve it
    startTick: b.fork_tick,
    headTick: b.head_tick,
  };
}

function toChromeCommit<P>(c: HCommit<P>): ChromeCommit {
  const idStr = `c-${c.id}`;
  const params = payloadAsParams(c.payload);
  return {
    id: idStr,
    branchId: c.branch_id,
    tick: c.tick,
    hash: padHash(c.id),
    msg: deriveMsg(c.payload),
    ...(c.parent_id !== null ? { parentCommitId: `c-${c.parent_id}` } : {}),
    ...(params ? { params } : {}),
    ...(c.inner !== undefined ? { hasInner: true } : {}),
  };
}

// Cast the substrate's commit payload into the chrome's flat-key Params
// slot. Works as long as the payload is a Record of primitives.
function payloadAsParams(payload: unknown): Params | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const out: Params = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "string"
    ) {
      out[k] = v;
    }
  }
  return out;
}

function deriveMsg(payload: unknown): string {
  // Substrate-agnostic: surface a terminal outcome as the commit message
  // (e.g. a duel's "p1_wins" / "p2_wins"). Otherwise empty —
  // the chrome shows hash + tick chips regardless.
  if (payload === null || typeof payload !== "object") return "";
  const o = (payload as Record<string, unknown>).outcome;
  if (typeof o === "string" && o !== "in_progress") return o;
  return "";
}

function padHash(id: number): string {
  // 7-char hex padding so the chrome's hashFmt has something to render.
  // Mixing the id with a prime keeps consecutive commits visually
  // distinct without pretending these are content hashes.
  const mixed = (id * 0x9e3779b1) >>> 0;
  return mixed.toString(16).padStart(8, "0").slice(0, 7);
}
