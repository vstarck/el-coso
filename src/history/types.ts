// History layer types. Sits between engine and lens: substrates remain pure
// (`(State, Inputs) → State`), the lens stays a view. This layer holds the
// input log, commit log, keyframes, and branch tree that the BTTF mechanic
// needs. Substrate code stays Godot-portable; this package is portable too
// (plain types + free functions, no classes).
//
// Three logs per branch:
//
//   Input log    — dense, one entry per tick on this branch's segment.
//                  Replay-determinism source. Substrate-typed via Input.
//   Commit log   — sparse, emitted only when the substrate's predicate
//                  fires. UI-facing. Tree-shaped via branch.parent +
//                  commit.parent_id, so seek/branch/checkout compose
//                  without a data migration.
//   Keyframes    — periodic full-state snapshots on this branch's segment.
//                  Caches for state_at; removing them must not change
//                  observable behavior.

import type {
  ResolutionRecord,
  RNGState,
  Substrate,
  SubstrateBundle,
} from "@/engine/types";

export type BranchId = string;

export type InputEntry<Input> = {
  tick: number;
  input: Input;
  // Engine-owned transcript (spec/27 Stage B): resolver answers minted
  // during this tick, in call order. Written by the history driver, never
  // by substrate code. Absent when the tick resolved nothing or transcript
  // recording is off (resolver_mode "rng"). Load-bearing for replay ONLY
  // under `entropy` mode; under `rng`/`verify` the keyframed seed
  // re-derives the same answers.
  resolutions?: ResolutionRecord[];
};

// How the history layer backs the resolver seam (spec/27):
//   "rng"     — threaded RNG, no transcript; replay re-derives from the
//               keyframed seed. The pre-spec contract, verbatim.
//   "verify"  — threaded RNG live AND transcript recorded; replay re-derives
//               and compares, throwing on drift. CI drift detector.
//   "entropy" — injected unseeded draw; the transcript is the ONLY record
//               of the past, and replay serves it verbatim.
export type ResolverMode = "rng" | "verify" | "entropy";

export type Commit<Payload> = {
  id: number;
  branch_id: BranchId;
  // Previous commit on the same lineage (walking up `branch.parent` if this
  // is the first commit on the branch). `null` only for the root commit.
  parent_id: number | null;
  tick: number;
  payload: Payload;
  // A commit is a *recursive* artifact: it may carry an entire nested
  // History — a child scene's full tree, retained when the scene resolved
  // (the L0.5 "child-input-log" memo level). This is what
  // makes the "history as tree" view a tree *of trees*: a resolve commit is
  // a node you can drill into. Inert for the parent's own replay (the child
  // outcome is already baked into the parent input log as the `resolve_*`
  // entry); kept so the round that was played stays inspectable, not a black
  // box. The history layer treats it opaquely — only the scene runtime and
  // the drill-in view know its concrete substrate types.
  inner?: AnyHistory;
};

// Keyframe payload — a deep-ish copy of every field on the substrate's
// `read` struct (typed arrays cloned; scalars copied). Restored into BOTH
// substrate buffers so `doubled: true` channels don't carry staleness in
// the swap-target buffer. RNG is captured alongside so replay resumes
// deterministically from the keyframe. Under resolver_mode "entropy" the
// captured rng is vestigial (populated, ignored): replay comes from the
// input log's transcripts, never from seed re-derivation (spec/27
// Invariant 10).
//
// State is shape-erased here. Generic copy logic in `history.ts` iterates
// fields with runtime typeof checks — maps cleanly to GDScript Dictionary
// iteration.
export type Keyframe<State> = {
  tick: number;
  snapshot: State;
  rng: RNGState;
};

// A substrate's BTTF contract. Two pure functions; the substrate stays
// agnostic of history mechanics — the adapter is a *description* of when
// commits fire and what they carry, supplied by the substrate package
// alongside its engine bundle.
export type HistoryAdapter<State, Input, CommitPayload> = {
  root_commit: (state: State) => CommitPayload;
  commit_predicate: (
    before: State,
    after: State,
    input: Input,
  ) => CommitPayload | null;
};

// State shape required by the history layer. Substrates already carry a
// `tick: number` counter on their state struct (see each substrate's
// types.ts); the history layer just makes that an explicit constraint so
// keyframes / state_at can record the post-tick value without runtime
// introspection.
export type TickedState = { tick: number };

// One branch segment in the tree. Inputs / commits / keyframes all cover
// the half-open range (fork_tick, head_tick]; on the root branch the range
// is (0, head_tick] with a tick-0 root keyframe.
//
// The root branch is the only branch with `parent_branch_id === null`
// (and `fork_tick === 0`); every other branch forks from a parent at
// `fork_tick > 0`.
export type Branch<State, Input, CommitPayload> = {
  id: BranchId;
  parent_branch_id: BranchId | null;
  fork_tick: number;
  inputs: InputEntry<Input>[];
  commits: Commit<CommitPayload>[];
  keyframes: Keyframe<State>[];
  head_tick: number;
};

// History handle. Plain struct; mutated through free functions in
// `history.ts`. The substrate handle is a member so callers reach
// `history.substrate.read` for rendering — the same idiom as raw
// substrate use. The substrate represents whichever (branch, tick) the
// caller last anchored to via historyTick / historyStateAt /
// historySetActiveBranch.
export type History<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
> = {
  bundle: SubstrateBundle<State, Config, Input>;
  config: Config;
  adapter: HistoryAdapter<State, Input, CommitPayload>;
  substrate: Substrate<State>;
  rng: RNGState;
  rng_seed_initial: number;
  branches: Record<BranchId, Branch<State, Input, CommitPayload>>;
  active: BranchId;
  // Which branch the substrate buffers currently represent (together with
  // `substrate.read.tick`). Maintained by historyTick / historyStateAt.
  // Distinct from `active`: a read-only scrub (historyStateAt on another
  // branch) moves the anchor without moving `active`, and the fast-path
  // check keys on the anchor — otherwise a same-tick query across branches
  // would alias one branch's state onto another.
  anchored_branch: BranchId;
  root_branch_id: BranchId;
  next_commit_id: number;
  keyframe_period: number;
  // Resolver backing (spec/27 Stage B). Absent = "rng" (default;
  // byte-identical to pre-spec behavior, no transcript recorded).
  resolver_mode?: ResolverMode;
  // Required iff resolver_mode === "entropy". Injected impure draw in
  // [0, 1) — the engine stays platform-agnostic; the app tier supplies
  // e.g. a crypto.getRandomValues-based source.
  entropy_draw?: () => number;
};

// Shape-erased History, for the recursive `Commit.inner` slot. A nested
// scene history is a *different* substrate (the child) with its own type
// params; the history layer that hosts it stays agnostic of those, so the
// recursion is expressed once here rather than threaded through every
// generic. The scene runtime and the drill-in view recover the concrete
// types at the edges.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHistory = History<any, any, any, any>;
