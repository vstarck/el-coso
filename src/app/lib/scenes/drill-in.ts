/* Drill-in — read-only navigation into recursive commits. The
 * inspection counterpart to scene-stack.ts: where the scene stack *plays* a
 * child and bakes its outcome, this layer *reviews* a child that already
 * played, by descending into a commit's retained `inner` history
 * and scrubbing it — recursively.
 *
 * Two stacks, kept separate: the scene-stack is
 * control-flow (live, ticks, bakes) and is NEVER touched here; the drill-in
 * path is navigation — a read-only cursor that changes no history and
 * advances no substrate (Invariants 1, 2, 6). They meet only at the host's
 * mount-resolution + the re-mount bump.
 *
 * The path itself lives in the store (view state). This module is the
 * primitive over it: pure, headless-testable, pokes the store like
 * scene-stack.ts does. It owns A′ — lens resolution by bundle identity.
 *
 * Liveness model: while reviewing, `playheadTick` IS the live read position
 * of the TOP step (exactly as it is the live position during normal play),
 * so the chrome's existing playhead drag scrubs the inner history with no
 * change. `DrillStep.scrub_tick` holds a level's *saved* position while it
 * sits below the top (restored on ascend); the parent's own playhead is
 * stashed in `drillReturnTick` and restored when the path empties
 * (entering/leaving review must not lose the parent's cursor).
 */

import { historyStateAt, type BranchId, type Commit } from "@/history";
import type { AnyHistory } from "@/history/types";
import { useStore } from "@/app/store";
import { sceneDepth } from "./scene-stack";
import type { Lens } from "@/lenses/types";

// One level of descent. Read-only: `history` is a retained child tree; the
// step never advances it, only reads at the live position. `scrub_tick` is
// the saved read position for a step sitting below the top (the top step's
// live position is `playheadTick`).
export type DrillStep = {
  history: AnyHistory;
  origin_commit_id: number; // the resolve commit it hangs off (breadcrumb / ascend target)
  branch_id: BranchId; // active branch within `history`
  scrub_tick: number; // saved read position (for non-top steps)
};

// What the host mounts while reviewing. Resolved via A′.
export type ReviewFrame = {
  history: AnyHistory;
  substrate_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lens: Lens<any, any, any, any>;
  branch_id: BranchId;
  scrub_tick: number; // the LIVE read position (= playheadTick)
};

// The slice of the substrate registry A′ needs. Structurally a subset of
// `SubstrateEntry` (src/app/substrates.ts), supplied via `setDrillRegistry`
// rather than imported, so this module stays free of the chrome's lens
// graph and remains importable headless (Tier-3). The app injects the real
// `SUBSTRATES` once at session load; tests get it for free via that same
// load (session is reached transitively) or can inject their own.
type DrillRegistry = ReadonlyArray<{
  id: string;
  bundle: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lenses: Record<string, Lens<any, any, any, any>>;
  defaultLensId: string;
}>;

let registry: DrillRegistry = [];

export function setDrillRegistry(r: DrillRegistry): void {
  registry = r;
}

// A′ — recover the child substrate from the inner history's bundle by
// reference identity. Bundles are module singletons (one per package), so an
// exact `===` match against the registry yields the entry's lenses +
// default. Nothing is stored on the commit — `Commit.inner` stays a bare,
// self-describing replay source.
export function resolveInnerSubstrate(h: AnyHistory): {
  substrate_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lenses: Record<string, Lens<any, any, any, any>>;
  defaultLensId: string;
} {
  for (const e of registry) {
    if (e.bundle === h.bundle) {
      return { substrate_id: e.id, lenses: e.lenses, defaultLensId: e.defaultLensId };
    }
  }
  throw new Error("drill-in: no registered substrate owns this inner history's bundle");
}

// Clamp a read tick to a branch's valid range. historyStateAt accepts
// [fork_tick, head_tick]; spec phrases it (fork, head] but reading at the
// fork point (the inherited state) is harmless and useful for the root.
function clampToBranch(h: AnyHistory, branch_id: BranchId, tick: number): number {
  const b = h.branches[branch_id];
  if (!b) return tick;
  return Math.max(b.fork_tick, Math.min(b.head_tick, tick));
}

function topStep(): DrillStep | null {
  const path = useStore.getState().drill;
  return path.length > 0 ? path[path.length - 1]! : null;
}

export function isReviewing(): boolean {
  return useStore.getState().drill.length > 0;
}

// Push a descent step into `commit.inner`. Guards: `inner` present AND
// sceneDepth()===1 (mutual exclusion with a live child, Invariant 3). Starts
// at the inner branch head, stashes the parent's playhead, bumps the
// re-mount version. Returns whether review was entered.
export function drillInto(commit: Commit<unknown>): boolean {
  if (sceneDepth() !== 1) return false;
  const inner = commit.inner;
  if (!inner) return false;

  const branch_id = inner.active;
  const head = inner.branches[branch_id]!.head_tick;
  const store = useStore.getState();
  store.setDrillReturnTick(store.playheadTick); // restored on ascendToRoot
  store.setDrill([
    { history: inner, origin_commit_id: commit.id, branch_id, scrub_tick: head },
  ]);
  store.setPlayheadTick(head);
  store.bumpDrill();
  return true;
}

// Descend from WITHIN the current step into an inner-of-inner commit
// (recursive). Same guards minus the depth check (already reviewing). Saves
// the current top's live position into its step before pushing.
export function drillDeeper(commit: Commit<unknown>): boolean {
  if (!isReviewing()) return false;
  const inner = commit.inner;
  if (!inner) return false;

  const store = useStore.getState();
  const path = store.drill;
  const savedTop: DrillStep = { ...path[path.length - 1]!, scrub_tick: store.playheadTick };
  const branch_id = inner.active;
  const head = inner.branches[branch_id]!.head_tick;
  store.setDrill([
    ...path.slice(0, -1),
    savedTop,
    { history: inner, origin_commit_id: commit.id, branch_id, scrub_tick: head },
  ]);
  store.setPlayheadTick(head);
  store.bumpDrill();
  return true;
}

// Move the read position on the top step (clamped to its branch range).
// Read-only — drives `playheadTick`, never `historyTick`.
export function scrubInner(tick: number): void {
  const top = topStep();
  if (!top) return;
  useStore.getState().setPlayheadTick(clampToBranch(top.history, top.branch_id, tick));
}

// Pop one level (LIFO). When the path empties the host re-projects the
// scene-stack frame and the parent's playhead is restored. Bakes nothing,
// ticks nothing (Invariant 6).
export function ascend(): void {
  const store = useStore.getState();
  const path = store.drill;
  if (path.length === 0) return;
  const next = path.slice(0, -1);
  store.setDrill(next);
  if (next.length === 0) {
    store.setPlayheadTick(store.drillReturnTick ?? 0);
    store.setDrillReturnTick(null);
  } else {
    store.setPlayheadTick(next[next.length - 1]!.scrub_tick);
  }
  store.bumpDrill();
}

export function ascendToRoot(): void {
  const store = useStore.getState();
  if (store.drill.length === 0) return;
  store.setDrill([]);
  store.setPlayheadTick(store.drillReturnTick ?? 0);
  store.setDrillReturnTick(null);
  store.bumpDrill();
}

// The frame the host mounts while reviewing — the top step resolved via A′.
// `scrub_tick` reflects the LIVE position (`playheadTick`). null = not
// reviewing (host projects the scene-stack active frame).
export function reviewFrame(): ReviewFrame | null {
  const top = topStep();
  if (!top) return null;
  const { substrate_id, lenses, defaultLensId } = resolveInnerSubstrate(top.history);
  return {
    history: top.history,
    substrate_id,
    lens: lenses[defaultLensId]!,
    branch_id: top.branch_id,
    scrub_tick: useStore.getState().playheadTick,
  };
}

// The state the host should render while reviewing — the top step's history
// read at the live playhead. null when not reviewing. historyStateAt
// re-anchors the inner substrate read-only (Invariant 1: never historyTick).
export function reviewState(): unknown | null {
  const top = topStep();
  if (!top) return null;
  const tick = clampToBranch(top.history, top.branch_id, useStore.getState().playheadTick);
  return historyStateAt(top.history, top.branch_id, tick);
}

// Find a commit by raw numeric id within a history (parent while not
// reviewing, the inner tree while reviewing). The chrome owns the `c-<id>`
// string format; it passes the parsed id + the history it's viewing, keeping
// this module free of both the chrome id format and the `session` import.
export function commitInHistory(h: AnyHistory, raw_id: number): Commit<unknown> | null {
  for (const b of Object.values(h.branches)) {
    for (const c of b.commits) if (c.id === raw_id) return c as Commit<unknown>;
  }
  return null;
}
