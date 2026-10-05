import {
  allocSubstrate as engineAlloc,
  swap as engineSwap,
  tickAny as engineTickAny,
  tickReplay as engineTickReplay,
} from "@/engine/substrate";
import type { ResolutionRecord, SubstrateBundle } from "@/engine/types";
import { tapeApply, tapeDiff, tapeRestore, tapeSetPath, tapeShare, type TapeOp } from "./config-tape";
import type {
  Branch,
  BranchId,
  Commit,
  History,
  HistoryAdapter,
  InputEntry,
  Keyframe,
  ResolverMode,
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
  // Resolver backing (spec/27). Absent = "rng"; "entropy" additionally
  // requires entropy_draw and a tickResolve bundle (checked at historyTick).
  resolver_mode?: ResolverMode;
  entropy_draw?: () => number;
  // spec/31 §5: throw on a config write that bypassed historyEditConfig. A whole-config walk per tick: for tests.
  config_verify?: boolean;
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
    config_tape: tapeShare(args.config, undefined) as Config, // the root snapshot (spec/31)
    config_pending: null,
    config_staged: null,
    branches: {},
    active: root_branch_id,
    anchored_branch: root_branch_id,
    root_branch_id,
    next_commit_id: 0,
    keyframe_period,
  };
  if (args.resolver_mode !== undefined) h.resolver_mode = args.resolver_mode;
  if (args.entropy_draw !== undefined) h.entropy_draw = args.entropy_draw;
  if (args.config_verify) h.config_verify = true;
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
  // spec/31 §4: a reset rebuilds from the config AS IT STANDS (rele and una-wacha mutate, then reset), so the tape
  // restarts from it and a pending edit, already visibly not in effect, is discarded.
  h.config_tape = tapeShare(h.config, undefined) as Config;
  h.config_pending = null;
  h.config_staged = null;
  for (const key of Object.keys(h.branches)) delete h.branches[key];
  h.branches[h.root_branch_id] = makeEmptyBranch(h.root_branch_id, null, 0, 0);
  h.active = h.root_branch_id;
  h.anchored_branch = h.root_branch_id;
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

  // The config tape (spec/31): the edits made since the last tick land HERE, at the head, onto the head's config
  // (re-applied if already written: idempotent), and the tape moves along their paths only. No config walk.
  let configChanged = false;
  if (h.config_pending !== null) {
    const pending = h.config_pending;
    tapeApply(h.config, pending);
    h.config_tape = pending.reduce<Config>((t, op) => tapeSetPath(t, op.path, "delete" in op ? undefined : op.value) as Config, h.config_tape);
    h.config_pending = null;
    h.config_staged = null;
    configChanged = true;
  }
  if (h.config_verify) verifyConfig(h, h.config_tape, `before tick ${active.head_tick + 1}`);

  // Resolver backing (spec/27). Under "rng" (default) the transcript is
  // derived from the threaded RNG and discarded — replay re-derives from
  // the keyframed seed, the pre-spec contract verbatim. Under
  // "verify"/"entropy" the tick's records are attached to the InputEntry,
  // so the transcript rides the input log (branch-scoped by construction).
  const mode = h.resolver_mode ?? "rng";
  if (mode === "entropy") {
    if (!h.bundle.tickResolve) {
      throw new Error(
        "resolver_mode 'entropy' requires a tickResolve bundle — a classic tick threads seeded RNG (spec/27)",
      );
    }
    if (!h.entropy_draw) {
      throw new Error("resolver_mode 'entropy' requires entropy_draw (spec/27)");
    }
  }
  const t = engineTickAny(
    h.bundle,
    h.substrate,
    h.config,
    h.rng,
    input,
    mode === "entropy" ? h.entropy_draw : undefined,
  );
  h.rng = t.rng;
  engineSwap(h.substrate);

  const before = h.substrate.write;
  const after = h.substrate.read;

  const entry: InputEntry<Input> = { tick: after.tick, input };
  if (configChanged) entry.config = h.config_tape;
  if (mode !== "rng" && t.records !== null && t.records.length > 0) {
    entry.resolutions = t.records;
  }
  active.inputs.push(entry);
  active.head_tick = after.tick;
  h.anchored_branch = active.id;

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
    // No keyframe anywhere on lineage — replay from root state, under the root config.
    const rootConfig = h.branches[h.root_branch_id]!.keyframes[0]?.config;
    if (rootConfig === undefined) throw new Error("history: no root keyframe config to replay from (spec/31)");
    restoreConfig(h, rootConfig);
    const fresh = engineAlloc(h.bundle, h.config);
    h.substrate.read = fresh.read;
    h.substrate.write = fresh.write;
    h.rng = { seed: h.rng_seed_initial };
    replayForward(h, lineage, 0, 0, tick);
  } else {
    const k = best.keyframe;
    if (k.config === undefined) throw new Error(`history: keyframe at tick ${k.tick} carries no config (spec/31)`);
    restoreConfig(h, k.config);
    restoreSnapshot(h.substrate.read, k.snapshot);
    restoreSnapshot(h.substrate.write, k.snapshot);
    h.rng = { seed: k.rng.seed };
    replayForward(h, lineage, best.segment_index, k.tick, tick);
  }

  h.anchored_branch = branch_id;
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
//
// `records` — the tick's recorded resolutions, for callers walking an input
// log whose entries carry a transcript (spec/27: pass
// `entry.resolutions ?? undefined`). When absent, the fallback follows the
// history's resolver_mode: under "rng" the resolver re-derives from the
// threaded RNG exactly as before; under "verify"/"entropy" absence means
// "this tick resolved nothing" and a bundle that does resolve throws
// instead of silently falling back to seed derivation (Invariant 10).
export function historyAdvance<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  input: NoInfer<Input>,
  records?: ResolutionRecord[],
): void {
  const mode = h.resolver_mode ?? "rng";
  // spec/31: behind the head the tape wins, found HERE rather than passed in (the ~30 lens call sites pass an input
  // they build themselves). At or beyond the head nothing is touched: six substrates drive everything through
  // historyAdvance, keep no log, and write their config every frame.
  const logged = loggedEntryAfter(h);
  if (logged !== null && logged.config !== undefined) restoreConfig(h, logged.config);
  h.rng = engineTickReplay(
    h.bundle,
    h.substrate,
    h.config,
    h.rng,
    input,
    records ?? (mode === "rng" ? null : []),
    mode === "verify",
  ).rng;
  engineSwap(h.substrate);
}

// THE live config edit (spec/31 §3.2): every channel that changes a config value while a history runs (a lens's
// setTunable, the Rules rail, the embed) goes through here, so replay can reproduce it. `path` is the key path into
// the config; `value` undefined deletes an object key. At the head the live config is written at once; behind the
// head (scrubbed back) it is NOT (the past is shown as it ran), and either way the edit lands on the next
// `historyTick`, at the head. Refuses what the Rules rail's setByPath skipped silently: a path through a missing or
// non-object parent.
export function historyEditConfig<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  h: History<State, Config, Input, CommitPayload>,
  path: readonly (string | number)[],
  value: unknown,
): void {
  if (path.length === 0) throw new Error("historyEditConfig: empty path (the config itself cannot be replaced)");
  let parent: unknown = h.config;
  for (const k of path.slice(0, -1)) {
    const next = (parent as Record<string | number, unknown>)[k];
    if (next === null || typeof next !== "object") throw new Error(`historyEditConfig: ${path.join(".")}: "${String(k)}" is not an object`);
    parent = next;
  }
  if (value === undefined && (Array.isArray(parent) || ArrayBuffer.isView(parent))) throw new Error(`historyEditConfig: ${path.join(".")}: cannot delete an array element`);
  const op: TapeOp = value === undefined ? { path: [...path], delete: true } : { path: [...path], value: tapeShare(value, undefined) };
  const active = h.branches[h.active];
  if (!active) throw new Error(`active branch missing: ${h.active}`);
  if (atOrBeyondHead(h)) {
    h.config_staged = tapeSetPath(h.config_staged ?? h.config_tape, op.path, "delete" in op ? undefined : op.value) as Config;
    tapeApply(h.config, [op]);
  }
  // ⚠ CONSECUTIVE edits to one path coalesce: the later would overwrite the earlier anyway, and on an advance-only
  // history (which never reaches a `historyTick` to drain this) a dragged slider otherwise grew the queue for the whole
  // run (S248). Only the LAST queued op is compared: dropping an earlier same-path op across an intervening edit to a
  // parent or child path could reorder a delete before a write through it, so that case still queues.
  const last = h.config_pending?.[h.config_pending.length - 1];
  const samePath = last !== undefined && last.path.length === op.path.length && last.path.every((k, i) => k === op.path[i]);
  h.config_pending = h.config_pending === null ? [op] : samePath ? [...h.config_pending.slice(0, -1), op] : [...h.config_pending, op];
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
  const mode = h.resolver_mode ?? "rng";
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
      if (entry.config !== undefined) restoreConfig(h, entry.config); // spec/31: the config this tick ran under
      // Serve the entry's transcript per resolver_mode (spec/27): "rng" —
      // no transcript, re-derive from the keyframed seed; "verify" —
      // re-derive AND compare, throw on drift; "entropy" — the transcript
      // is the only past (an absent entry means "resolved nothing", and a
      // bundle that does resolve throws rather than falling back to seed).
      h.rng = engineTickReplay(
        h.bundle,
        h.substrate,
        h.config,
        h.rng,
        entry.input,
        entry.resolutions ?? (mode === "rng" ? null : []),
        mode === "verify",
      ).rng;
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
    config: h.config_tape, // by reference: tape snapshots are immutable (spec/31)
  });
}

// --- config tape helpers (spec/31) ----------------------------------------

// Restore a tape snapshot into the live config IN PLACE (its identity is held by lens closures and engine caches),
// and make it the tape's current snapshot. Staged edits stay pending: they land at the head.
function restoreConfig<S extends TickedState, C, I, P>(h: History<S, C, I, P>, snap: unknown): void {
  const equalTo = h.config_staged ?? h.config_tape; // what the live config equals, so shared subtrees are skipped
  if (h.config_verify) verifyConfig(h, equalTo, "before a config restore");
  tapeRestore(h.config, snap, equalTo);
  h.config_tape = snap as C;
  h.config_staged = null;
}

// The guard (spec/31 §5): the live config must equal what the API recorded; a difference is a write that bypassed
// historyEditConfig, and it is named.
function verifyConfig<S extends TickedState, C, I, P>(h: History<S, C, I, P>, expected: unknown, when: string): void {
  if (tapeShare(h.config, expected) === expected) return;
  const paths = tapeDiff(h.config, expected).map((op) => op.path.join("."));
  throw new Error(`history: config written without historyEditConfig (${when}): ${paths.join(", ")}`);
}

// The logged entry that takes the anchored substrate from its current tick to the next, or null when the substrate
// is at or beyond its anchored branch's head (nothing logged to replay: the log-less loops live there).
function loggedEntryAfter<S extends TickedState, C, I, P>(h: History<S, C, I, P>): InputEntry<I> | null {
  // ⚠ the anchored branch, not the active one: replay follows where the substrate IS. `atOrBeyondHead` adds the
  // active-branch test because an EDIT is the active branch's; the tick rule is this one, shared.
  if (anchoredAtOrBeyondHead(h)) return null;
  const branch = h.branches[h.anchored_branch]!;
  const tick = h.substrate.read.tick;
  const next = tick + 1;
  for (const seg of buildLineage(h, h.anchored_branch, next)) {
    if (next > seg.from && next <= seg.to) return seg.branch.inputs[next - seg.branch.fork_tick - 1] ?? null;
  }
  return null;
}

// ★ "Live" for a config edit: the substrate is on the active branch AT or BEYOND its head. The ONE predicate, shared by
// `historyEditConfig` (write the live config now) and `loggedEntryAfter` (behind the head the tape wins). spec/32 D1
// (S248): they used to disagree — the edit path tested EXACTLY at the head, the advance path at-or-beyond — and an
// advance-only history, whose head never moves past 0, ran beyond it, so every edit after tick 0 was parked for a
// `historyTick` that never came. A scrubbed substrate (behind the head) still stages its edit for the next head tick.
function atOrBeyondHead<S extends TickedState, C, I, P>(h: History<S, C, I, P>): boolean {
  return h.anchored_branch === h.active && anchoredAtOrBeyondHead(h);
}
/** the tick half of the rule, on the branch the substrate IS on (replay follows the anchor) */
function anchoredAtOrBeyondHead<S extends TickedState, C, I, P>(h: History<S, C, I, P>): boolean {
  const branch = h.branches[h.anchored_branch];
  return branch !== undefined && h.substrate.read.tick >= branch.head_tick;
}

// True iff the substrate's current `read` carries (branch, tick), keyed on
// the explicitly tracked anchor. The anchor (not `active`) is what the
// buffers actually hold: a read-only scrub of another branch moves it
// without moving `active`, and keying the fast path on `active` aliased
// one branch's state onto another whenever the ticks coincided (caught by
// the spec/27 cross-branch transcript tests).
function substrateAt<S extends TickedState, C, I, P>(
  h: History<S, C, I, P>,
  branch_id: BranchId,
  tick: number,
): boolean {
  return branch_id === h.anchored_branch && h.substrate.read.tick === tick;
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

// Uniformly recursive: the SAME type dispatch (typed array / array / object /
// scalar) applies at every depth, not just the top level. The earlier
// shape-enumerating helpers cloned an array nested inside an array — e.g. a
// `number[][]` field on an element of a state array — as a plain object
// ({"0": …}), silently corrupting the keyframe; a typed array nested below
// the top level had the same hole.
function cloneField(v: unknown): unknown {
  if (isTypedArray(v)) {
    // Copy via the view's own constructor — preserves the exact subtype
    // (Float32Array → Float32Array, Int32Array → Int32Array, etc.).
    const ctor = (v as ArrayBufferView).constructor as new (src: ArrayBufferView) => ArrayBufferView;
    return new ctor(v);
  }
  if (Array.isArray(v)) return v.map((x) => cloneField(x));
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(o)) out[key] = cloneField(o[key]);
    return out;
  }
  return v;
}
