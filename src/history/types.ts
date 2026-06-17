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

import type { RNGState, Substrate, SubstrateBundle } from "@/engine/types";

export type BranchId = string;

export type InputEntry<Input> = {
  tick: number;
  input: Input;
};

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
// deterministically from the keyframe.
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
  root_branch_id: BranchId;
  next_commit_id: number;
  keyframe_period: number;
};

// Shape-erased History, for the recursive `Commit.inner` slot. A nested
// scene history is a *different* substrate (the child) with its own type
// params; the history layer that hosts it stays agnostic of those, so the
// recursion is expressed once here rather than threaded through every
// generic. The scene runtime and the drill-in view recover the concrete
// types at the edges.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHistory = History<any, any, any, any>;
