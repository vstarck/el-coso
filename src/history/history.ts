import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tick as engineTick,
} from "@/engine/substrate";
import type { SubstrateBundle } from "@/engine/types";
import type {
  Branch,
  BranchId,
  Commit,
  History,
  HistoryAdapter,
  Keyframe,
  TickedState,
} from "./types";

// Default keyframe interval. Per-substrate overrides via createHistory's
// keyframe_period arg; Infinity disables keyframing past the root keyframe.
const DEFAULT_KEYFRAME_PERIOD = 100;
const DEFAULT_ROOT_BRANCH_ID = "main";

// --- construction ---------------------------------------------------------

export function createHistory<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(args: {
  bundle: SubstrateBundle<State, Config, Input>;
  config: Config;
  rng_seed: number;
  adapter: HistoryAdapter<State, Input, CommitPayload>;
  keyframe_period?: number;
  root_branch_id?: string;
}): History<State, Config, Input, CommitPayload> {
  const substrate = engineAlloc(args.bundle, args.config);
  const root_branch_id = args.root_branch_id ?? DEFAULT_ROOT_BRANCH_ID;
  const keyframe_period = args.keyframe_period ?? DEFAULT_KEYFRAME_PERIOD;

  const h: History<State, Config, Input, CommitPayload> = {
    bundle: args.bundle,
    config: args.config,
    adapter: args.adapter,
    substrate,
    rng: { seed: args.rng_seed },
    rng_seed_initial: args.rng_seed,
    branches: {},
    active: root_branch_id,
    root_branch_id,
    next_commit_id: 0,
    keyframe_period,
  };
  h.branches[root_branch_id] = makeEmptyBranch(root_branch_id, null, 0, 0);

  emitRootCommit(h);
  // Always capture tick-0 keyframe on the root branch — guarantees
  // historyStateAt(root, 0) is a one-copy restore even when
  // keyframe_period === Infinity.
  pushKeyframe(h, h.branches[root_branch_id]!);
  return h;
}

export function historyReset<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(h: History<State, Config, Input, CommitPayload>): void {
  const fresh = engineAlloc(h.bundle, h.config);
  h.substrate.read = fresh.read;
  h.substrate.write = fresh.write;
  h.rng = { seed: h.rng_seed_initial };
  for (const key of Object.keys(h.branches)) delete h.branches[key];
  h.branches[h.root_branch_id] = makeEmptyBranch(h.root_branch_id, null, 0, 0);
  h.active = h.root_branch_id;
  h.next_commit_id = 0;
  emitRootCommit(h);
  pushKeyframe(h, h.branches[h.root_branch_id]!);
}

// --- hot path -------------------------------------------------------------

export function historyTick<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  // NoInfer keeps the Input generic anchored to `h`; without it, an inline
  // literal like `{ ghost_dir: "up" }` would re-infer Input as the wider
  // `{ ghost_dir: string }` and break the call.
  input: NoInfer<Input>,
): void {
  const active = h.branches[h.active];
  if (!active) throw new Error(`active branch missing: ${h.active}`);

  // Auto-anchor: the substrate may be parked at a scrub position from a
  // previous historyStateAt. Restore to (active, head_tick) before ticking
  // so the result lands on the active head. Lens-side code doesn't need
  // to think about this.
  if (!substrateAt(h, h.active, active.head_tick)) {
    historyStateAt(h, h.active, active.head_tick);
  }

  h.rng = engineTick(h.bundle, h.substrate, h.config, h.rng, input);
  engineSwap(h.substrate);

  const before = h.substrate.write;
  const after = h.substrate.read;

  active.inputs.push({ tick: after.tick, input });
  active.head_tick = after.tick;

  const payload = h.adapter.commit_predicate(before, after, input);
  if (payload !== null) {
    active.commits.push({
      id: h.next_commit_id++,
      branch_id: active.id,
      parent_id: lineageParentCommitId(h, active),
      tick: after.tick,
      payload,
    });
  }

  // Periodic keyframe on the active branch.
  if (shouldKeyframeAt(h.keyframe_period, after.tick)) {
    pushKeyframe(h, active);
  }
}

// --- BTTF primitives ------------------------------------------------------

export function historyStateAt<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  branch_id: BranchId,
  tick: number,
): Readonly<State> {
  const target = h.branches[branch_id];
  if (!target) throw new Error(`unknown branch: ${branch_id}`);
  if (tick < target.fork_tick) {
    throw new Error(`tick ${tick} precedes fork (${target.fork_tick}) of branch ${branch_id}`);
  }
  if (tick > target.head_tick) {
    throw new Error(`tick ${tick} exceeds head (${target.head_tick}) of branch ${branch_id}`);
  }

  // Fast path: substrate is already where the caller wants it.
  if (substrateAt(h, branch_id, tick)) return h.substrate.read;

  const lineage = buildLineage(h, branch_id, tick);
  const best = findBestKeyframe(lineage, tick);

  if (best === null) {
    // No keyframe anywhere on lineage — replay from root state.
    const fresh = engineAlloc(h.bundle, h.config);
    h.substrate.read = fresh.read;
    h.substrate.write = fresh.write;
    h.rng = { seed: h.rng_seed_initial };
    replayForward(h, lineage, 0, 0, tick);
  } else {
    const k = best.keyframe;
    restoreSnapshot(h.substrate.read, k.snapshot);
    restoreSnapshot(h.substrate.write, k.snapshot);
    h.rng = { seed: k.rng.seed };
    replayForward(h, lineage, best.segment_index, k.tick, tick);
  }

  return h.substrate.read;
}

// Advance the substrate by one tick WITHOUT appending to inputs or
// commits. Used by lenses in "replay mode" — walking forward through
// an existing record so the visual catches up to a canonical head_tick
// without re-emitting events that already exist there. Caller passes
// the per-tick input (typically the corresponding entry from the input
// log; for input-less substrates like Conway, an empty object).
//
// Unlike historyStateAt, this does NOT re-build the lineage or restore
// from a keyframe — it just advances from whatever state the substrate
// is currently in, at the same cost as a normal substrate tick. The
// caller is responsible for ensuring the substrate is at the expected
// tick first (typically by having previously called historyStateAt to
// re-anchor to a starting point).
export function historyAdvance<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  input: NoInfer<Input>,
): void {
  h.rng = engineTick(h.bundle, h.substrate, h.config, h.rng, input);
  engineSwap(h.substrate);
}

// Append a one-off commit on the active branch at the substrate's current
// tick. Used for out-of-band events the substrate-side `commit_predicate`
// can't see (e.g. a lens-side stale-detection that compares against
// snapshots the substrate doesn't keep). Returns the new commit's id.
export function historyAnnotate<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  payload: CommitPayload,
): number {
  const active = h.branches[h.active];
  if (!active) throw new Error(`active branch missing: ${h.active}`);
  const id = h.next_commit_id++;
  active.commits.push({
    id,
    branch_id: active.id,
    parent_id: lineageParentCommitId(h, active),
    tick: h.substrate.read.tick,
    payload,
  });
  return id;
}

export function historyBranchFrom<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  parent_id: BranchId,
  at_tick: number,
  new_id: BranchId,
): void {
  const parent = h.branches[parent_id];
  if (!parent) throw new Error(`unknown branch: ${parent_id}`);
  if (h.branches[new_id]) throw new Error(`branch already exists: ${new_id}`);
  if (at_tick < parent.fork_tick) {
    throw new Error(`fork tick ${at_tick} precedes parent fork (${parent.fork_tick})`);
  }
  if (at_tick > parent.head_tick) {
    throw new Error(`fork tick ${at_tick} exceeds parent head (${parent.head_tick})`);
  }

  h.branches[new_id] = makeEmptyBranch(new_id, parent_id, at_tick, at_tick);
}

export function historySetActiveBranch<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  id: BranchId,
): void {
  const target = h.branches[id];
  if (!target) throw new Error(`unknown branch: ${id}`);
  h.active = id;
  historyStateAt(h, id, target.head_tick);
}

export function historyTruncate<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  branch_id: BranchId,
  at_tick: number,
): void {
  const branch = h.branches[branch_id];
  if (!branch) throw new Error(`unknown branch: ${branch_id}`);
  if (at_tick < branch.fork_tick) {
    throw new Error(`truncate tick ${at_tick} precedes branch fork (${branch.fork_tick})`);
  }
  if (at_tick > branch.head_tick) {
    throw new Error(`truncate tick ${at_tick} exceeds branch head (${branch.head_tick})`);
  }

  // Cascade: every branch forked past the cut goes with it. A caller that
  // wants to refuse a destructive truncate (a "no take-backs" mode) checks
  // `historyDescendantsForkedPast` first and declines; there is no policy
  // knob — the one truncate does the one thing rewind/checkout needs.
  const descendants = collectDescendantsForkedPast(h.branches, branch_id, at_tick);
  for (const id of descendants) delete h.branches[id];
  if (!h.branches[h.active]) h.active = h.root_branch_id;

  // Slice the target branch.
  const keep_inputs = at_tick - branch.fork_tick;
  branch.inputs = branch.inputs.slice(0, keep_inputs);
  branch.commits = branch.commits.filter((c) => c.tick <= at_tick);
  branch.keyframes = branch.keyframes.filter((k) => k.tick <= at_tick);
  branch.head_tick = at_tick;

  // Re-anchor substrate. If it was on the truncated branch (or on a
  // descendant that just got cascaded), bring it back to a valid state.
  if (h.active === branch_id) {
    historyStateAt(h, branch_id, at_tick);
  } else if (!h.branches[h.active]) {
    h.active = h.root_branch_id;
    const root = h.branches[h.root_branch_id]!;
    historyStateAt(h, h.active, root.head_tick);
  }
}

// Branches a `historyTruncate(h, branch_id, at_tick)` would cascade away:
// every descendant (transitively) whose `fork_tick` is past the cut. A
// caller that wants to refuse a destructive truncate inspects this first;
// an empty result means truncating loses no branches.
export function historyDescendantsForkedPast<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  branch_id: BranchId,
  at_tick: number,
): BranchId[] {
  return collectDescendantsForkedPast(h.branches, branch_id, at_tick);
}

// --- inspection -----------------------------------------------------------

export function historyActiveBranch<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
): Branch<State, Input, CommitPayload> {
  const b = h.branches[h.active];
  if (!b) throw new Error(`active branch missing: ${h.active}`);
  return b;
}

export function historyListBranches<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
): Branch<State, Input, CommitPayload>[] {
  return Object.values(h.branches);
}

// Lineage walk: commits on the requested branch, plus all commits on
// ancestor branches up to-and-including their fork_tick. Used by the chrome
// to render a single branch's history in temporal order.
export function historyLineageCommits<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  branch_id: BranchId,
): Commit<CommitPayload>[] {
  const target = h.branches[branch_id];
  if (!target) throw new Error(`unknown branch: ${branch_id}`);
  const out: Commit<CommitPayload>[] = [];
  // Walk root → ... → target. Use buildLineage with target.head_tick.
  const lineage = buildLineage(h, branch_id, target.head_tick);
  for (const seg of lineage) {
    for (const c of seg.branch.commits) {
      if (c.tick >= seg.from && c.tick <= seg.to) out.push(c);
    }
  }
  return out;
}

// --- internals ------------------------------------------------------------

type LineageSegment<State extends TickedState, Input, CommitPayload> = {
  branch: Branch<State, Input, CommitPayload>;
  // Half-open lineage range this segment contributes: from is exclusive of
  // the fork-into-this-branch point in terms of *applying inputs* (the
  // input that takes you from state-at-from to state-at-(from+1) lives at
  // index 0 on this branch's inputs), inclusive of state at `from`.
  // `to` is the inclusive upper tick this segment carries.
  from: number;
  to: number;
};

function makeEmptyBranch<S extends TickedState, I, P>(
  id: BranchId,
  parent_branch_id: BranchId | null,
  fork_tick: number,
  head_tick: number,
): Branch<S, I, P> {
  return {
    id,
    parent_branch_id,
    fork_tick,
    inputs: [],
    commits: [],
    keyframes: [],
    head_tick,
  };
}

function emitRootCommit<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
): void {
  const root = h.branches[h.root_branch_id]!;
  const payload = h.adapter.root_commit(h.substrate.read);
  root.commits.push({
    id: h.next_commit_id++,
    branch_id: root.id,
    parent_id: null,
    tick: h.substrate.read.tick,
    payload,
  });
}

function lineageParentCommitId<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
  branch: Branch<S, I, P>,
): number | null {
  if (branch.commits.length > 0) {
    return branch.commits[branch.commits.length - 1]!.id;
  }
  // First commit on a non-root branch: walk up the parent chain and find
  // the most recent ancestor commit at-or-before the relevant fork_tick.
  let cursor_parent_id = branch.parent_branch_id;
  let cursor_fork_tick = branch.fork_tick;
  while (cursor_parent_id !== null) {
    const ancestor = h.branches[cursor_parent_id];
    if (!ancestor) break;
    for (let i = ancestor.commits.length - 1; i >= 0; i--) {
      if (ancestor.commits[i]!.tick <= cursor_fork_tick) {
        return ancestor.commits[i]!.id;
      }
    }
    cursor_parent_id = ancestor.parent_branch_id;
    cursor_fork_tick = ancestor.fork_tick;
  }
  return null;
}

function buildLineage<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
  branch_id: BranchId,
  target_tick: number,
): LineageSegment<S, I, P>[] {
  const chain: Branch<S, I, P>[] = [];
  let cursor: Branch<S, I, P> | undefined = h.branches[branch_id];
  if (!cursor) throw new Error(`unknown branch: ${branch_id}`);
  while (cursor) {
    chain.push(cursor);
    if (cursor.parent_branch_id === null) break;
    cursor = h.branches[cursor.parent_branch_id];
  }
  chain.reverse();

  const lineage: LineageSegment<S, I, P>[] = [];
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i]!;
    const from = b.fork_tick;
    const to =
      i === chain.length - 1
        ? target_tick
        : chain[i + 1]!.fork_tick;
    lineage.push({ branch: b, from, to });
  }
  return lineage;
}

function findBestKeyframe<S extends TickedState, I, P>(
  lineage: LineageSegment<S, I, P>[],
  target_tick: number,
): { keyframe: Keyframe<S>; segment_index: number } | null {
  let best: { keyframe: Keyframe<S>; segment_index: number } | null = null;
  for (let i = 0; i < lineage.length; i++) {
    const seg = lineage[i]!;
    for (const k of seg.branch.keyframes) {
      if (k.tick < seg.from) continue;
      if (k.tick > seg.to) continue;
      if (k.tick > target_tick) continue;
      if (best === null || k.tick > best.keyframe.tick) {
        best = { keyframe: k, segment_index: i };
      }
    }
  }
  return best;
}

function replayForward<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
  lineage: LineageSegment<S, I, P>[],
  from_segment: number,
  from_tick: number,
  to_tick: number,
): void {
  let cursor_tick = from_tick;
  for (let i = from_segment; i < lineage.length; i++) {
    const seg = lineage[i]!;
    const end = Math.min(seg.to, to_tick);
    if (cursor_tick >= end) {
      if (cursor_tick >= to_tick) break;
      continue;
    }
    const branch_fork = seg.branch.fork_tick;
    while (cursor_tick < end) {
      const next_tick = cursor_tick + 1;
      const idx = next_tick - branch_fork - 1;
      const entry = seg.branch.inputs[idx];
      if (!entry) {
        throw new Error(
          `replay: missing input at tick ${next_tick} on branch ${seg.branch.id} (idx ${idx})`,
        );
      }
      h.rng = engineTick(h.bundle, h.substrate, h.config, h.rng, entry.input);
      engineSwap(h.substrate);
      cursor_tick = next_tick;
    }
    if (cursor_tick >= to_tick) break;
  }
}

function collectDescendantsForkedPast<S extends TickedState, I, P>(
  branches: Record<BranchId, Branch<S, I, P>>,
  branch_id: BranchId,
  at_tick: number,
): BranchId[] {
  const childrenOf: Record<BranchId, BranchId[]> = {};
  for (const id of Object.keys(branches)) {
    const b = branches[id]!;
    if (b.parent_branch_id === null) continue;
    const pid = b.parent_branch_id;
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(id);
  }

  const out: BranchId[] = [];
  const queue: BranchId[] = [];
  for (const cid of childrenOf[branch_id] ?? []) {
    const c = branches[cid]!;
    if (c.fork_tick > at_tick) {
      out.push(cid);
      queue.push(cid);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const cid of childrenOf[cur] ?? []) {
      out.push(cid);
      queue.push(cid);
    }
  }
  return out;
}

function shouldKeyframeAt(period: number, tick: number): boolean {
  if (!Number.isFinite(period) || period <= 0) return false;
  return tick % period === 0;
}

function pushKeyframe<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
  branch: Branch<S, I, P>,
): void {
  branch.keyframes.push({
    tick: h.substrate.read.tick,
    snapshot: captureSnapshot(h.substrate.read),
    rng: { seed: h.rng.seed },
  });
}

// True iff the substrate's current `read` carries (branch, tick). Cheap
// equality check on the tick counter plus a lookup into the branch's
// keyframe of where we last anchored — but since we don't track that
// explicitly, we rely on tick equality + active match. Adequate for
// avoiding redundant work in the common case (consecutive ticks on the
// same branch); a missed fast-path is correctness-safe — just slower.
function substrateAt<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
  branch_id: BranchId,
  tick: number,
): boolean {
  return branch_id === h.active && h.substrate.read.tick === tick;
}

// --- snapshot helpers -----------------------------------------------------

// Generic field-by-field copy of a substrate state struct. Typed-array
// fields are duplicated; plain arrays + plain-object fields are deep-
// cloned (one nesting level past the State root — matches the
// translatable-TS data shapes the substrates ship). Scalars are copied
// by assignment. Maps to `state.duplicate(true)` in GDScript when ported.
function captureSnapshot<State extends TickedState>(state: State): State {
  const snap: Record<string, unknown> = {};
  const src = state as unknown as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    snap[key] = cloneField(src[key]);
  }
  return snap as unknown as State;
}

// Any TypedArray view (Float32/Int32/Uint8/...). `DataView` is excluded
// because it doesn't share the contiguous-buffer `.set(src)` semantics.
function isTypedArray(v: unknown): v is ArrayBufferView & { set: (src: ArrayBufferView) => void } {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function restoreSnapshot<State extends TickedState>(
  target: State,
  snapshot: State,
): void {
  const t = target as unknown as Record<string, unknown>;
  const s = snapshot as unknown as Record<string, unknown>;
  for (const key of Object.keys(s)) {
    const sv = s[key];
    const tv = t[key];
    if (isTypedArray(sv) && isTypedArray(tv)) {
      // TypedArray-to-TypedArray copy. Substrates must not swap a
      // channel's type/length mid-session (the channel discipline) so
      // .set() is always valid here.
      tv.set(sv);
    } else {
      // Plain arrays / plain objects: replace with a fresh clone so a
      // subsequent tick can't mutate the keyframe through the substrate's
      // read buffer.
      t[key] = cloneField(sv);
    }
  }
}

function cloneField(v: unknown): unknown {
  if (isTypedArray(v)) {
    // Copy via the view's own constructor — preserves the exact subtype
    // (Float32Array → Float32Array, Int32Array → Int32Array, etc.).
    const ctor = (v as ArrayBufferView).constructor as new (src: ArrayBufferView) => ArrayBufferView;
    return new ctor(v);
  }
  if (Array.isArray(v)) return v.map((x) => clonePlainValue(x));
  if (v !== null && typeof v === "object") return clonePlainObject(v as Record<string, unknown>);
  return v;
}

function clonePlainValue(v: unknown): unknown {
  if (v !== null && typeof v === "object") return clonePlainObject(v as Record<string, unknown>);
  return v;
}

function clonePlainObject(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (Array.isArray(v)) out[key] = v.map((x) => clonePlainValue(x));
    else if (v !== null && typeof v === "object") out[key] = clonePlainObject(v as Record<string, unknown>);
    else out[key] = v;
  }
  return out;
}
