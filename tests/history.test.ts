import { describe, expect, test } from "vitest";

import {
  createHistory,
  historyActiveBranch,
  historyBranchFrom,
  historyDescendantsForkedPast,
  historyLineageCommits,
  historyListBranches,
  historyReset,
  historySetActiveBranch,
  historyStateAt,
  historyTick,
  historyTruncate,
  type History,
  type HistoryAdapter,
} from "@/history";
import type { RNGState, SubstrateBundle } from "@/engine/types";

// --- A synthetic substrate fixture ---------------------------------------
//
// The history layer is substrate-agnostic — it talks only to a
// `SubstrateBundle` + `HistoryAdapter`, never to a substrate's gameplay. So
// it is tested against a tiny toy substrate defined right here, not against
// any shipped substrate. That keeps the engine's most intricate module
// covered IN THE PUBLIC REPO (its old real-substrate drivers live
// private), and immune to any substrate changing under it.
//
// The toy is a walker on a line. `dir ∈ {-1, 0, +1}` steers it; `pos`
// changes only when the move isn't wall-clamped — so a no-op or wall-banged
// input logs an input + advances the tick but emits no commit. State
// deliberately carries one field of every keyframed shape — `Uint8Array` /
// `Int32Array` / `Float32Array` + scalars — so keyframe capture/restore is
// exercised across all the typed-array clone paths (the `Int32Array`
// regression among them).

type ToyState = {
  tick: number;
  pos: number;
  heading: number;
  visited: Uint8Array; // Uint8 clone path
  steps: Int32Array; // Int32 clone path (regression)
  drift: Float32Array; // Float32 clone path
};

type ToyConfig = { width: number };
type ToyInput = { dir: number };
type ToyPayload = { tick: number; pos: number; heading: number };

const WIDTH = 8;

function makeToyState(config: ToyConfig): ToyState {
  return {
    tick: 0,
    pos: 0,
    heading: 0,
    visited: new Uint8Array(config.width),
    steps: new Int32Array(1),
    drift: new Float32Array(1),
  };
}

const toyBundle: SubstrateBundle<ToyState, ToyConfig, ToyInput> = {
  alloc: (config) => ({
    read: makeToyState(config),
    write: makeToyState(config),
  }),
  initState: (state) => {
    state.visited[0] = 1; // the walker starts on cell 0
  },
  tick: (r, w, config, rng: RNGState, inputs) => {
    w.tick = r.tick + 1;
    w.heading = inputs.dir;
    const next = Math.max(0, Math.min(config.width - 1, r.pos + inputs.dir));
    w.pos = next;
    w.visited.set(r.visited);
    w.visited[next] = 1;
    w.steps.set(r.steps);
    w.steps[0] = r.steps[0]! + (next !== r.pos ? 1 : 0);
    w.drift.set(r.drift);
    w.drift[0] = next * 0.5;
    return rng;
  },
};

const toyAdapter: HistoryAdapter<ToyState, ToyInput, ToyPayload> = {
  root_commit: (s) => ({ tick: s.tick, pos: s.pos, heading: s.heading }),
  // A commit fires only when the walker actually moves — a no-op or
  // wall-banged input advances the tick + logs the input but commits nothing.
  commit_predicate: (before, after) =>
    after.pos !== before.pos
      ? { tick: after.tick, pos: after.pos, heading: after.heading }
      : null,
};

function build(opts?: {
  keyframe_period?: number;
}): History<ToyState, ToyConfig, ToyInput, ToyPayload> {
  return createHistory({
    bundle: toyBundle,
    config: { width: WIDTH },
    rng_seed: 1,
    adapter: toyAdapter,
    ...(opts?.keyframe_period !== undefined
      ? { keyframe_period: opts.keyframe_period }
      : {}),
  });
}

// A mixed steering sequence that walks the line back and forth without
// parking permanently at a wall — exercises moves, no-ops, and reversals.
const MIXED: number[] = [1, 1, 1, -1, 0, 1, 1, -1, 0, 1, -1, 1];

// --- generic state comparison (covers every typed-array subtype) ---------

function isView(v: unknown): v is ArrayBufferView {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

// First differing key (typed arrays compared elementwise), or null if equal.
function diffState(a: ToyState, b: ToyState): string | null {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(ra)) {
    const va = ra[k];
    const vb = rb[k];
    if (isView(va) && isView(vb)) {
      const aa = va as unknown as { length: number; [i: number]: number };
      const bb = vb as unknown as { length: number; [i: number]: number };
      if (aa.length !== bb.length) return `${k}.length`;
      for (let i = 0; i < aa.length; i++) {
        if (aa[i] !== bb[i]) return `${k}[${i}]`;
      }
    } else if (va !== vb) {
      return k;
    }
  }
  return null;
}

function deepCloneState(s: ToyState): ToyState {
  const src = s as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    out[k] = isView(v)
      ? new (
          (v as ArrayBufferView).constructor as new (
            x: ArrayBufferView,
          ) => ArrayBufferView
        )(v as ArrayBufferView)
      : v;
  }
  return out as unknown as ToyState;
}

describe("history layer — linear behavior on root branch", () => {
  test("emits a root commit at construction", () => {
    const h = build();
    const main = historyActiveBranch(h);
    expect(main.commits).toHaveLength(1);
    expect(main.commits[0]!.parent_id).toBeNull();
    expect(main.commits[0]!.tick).toBe(0);
    expect(main.commits[0]!.id).toBe(0);
    expect(main.commits[0]!.branch_id).toBe("main");
  });

  test("createHistory captures a root keyframe at tick 0", () => {
    const h = build();
    const main = historyActiveBranch(h);
    expect(main.keyframes).toHaveLength(1);
    expect(main.keyframes[0]!.tick).toBe(0);
  });

  test("commit fires only when the walker's cell changes", () => {
    const h = build();
    for (let i = 0; i < 5; i++) historyTick(h, { dir: 0 });
    expect(historyActiveBranch(h).commits).toHaveLength(1);

    historyTick(h, { dir: 1 });
    const commits = historyActiveBranch(h).commits;
    expect(commits).toHaveLength(2);
    expect(commits[1]!.parent_id).toBe(0);
    expect(commits[1]!.tick).toBe(6);
  });

  test("wall bang produces no commit but still logs input", () => {
    const h = build(); // walker starts at cell 0; dir:-1 hits the wall.
    historyTick(h, { dir: -1 });
    const main = historyActiveBranch(h);
    expect(main.commits).toHaveLength(1);
    expect(main.inputs).toHaveLength(1);
    expect(main.inputs[0]!.input.dir).toBe(-1);
  });

  test("input log is dense; commit log is sparse", () => {
    const h = build();
    // pos from 0: +1→1, +1→2, 0→2, 0→2, -1→1, +1→2. Moves at 4 ticks.
    const sequence = [1, 1, 0, 0, -1, 1];
    for (const dir of sequence) historyTick(h, { dir });
    const main = historyActiveBranch(h);
    expect(main.inputs).toHaveLength(6);
    expect(main.commits).toHaveLength(1 + 4); // root + 4 moves
  });

  test("parent_id chains commits sequentially within a branch", () => {
    const h = build();
    historyTick(h, { dir: 1 });
    historyTick(h, { dir: 1 });
    historyTick(h, { dir: 1 });
    const commits = historyActiveBranch(h).commits;
    expect(commits.map((c) => c.id)).toEqual([0, 1, 2, 3]);
    expect(commits.map((c) => c.parent_id)).toEqual([null, 0, 1, 2]);
  });

  test("reset clears all branches and re-emits root", () => {
    const h = build();
    for (let i = 0; i < 3; i++) historyTick(h, { dir: 1 });
    expect(historyActiveBranch(h).commits.length).toBeGreaterThan(1);
    expect(historyActiveBranch(h).inputs.length).toBe(3);

    historyReset(h);

    const main = historyActiveBranch(h);
    expect(main.commits).toHaveLength(1);
    expect(main.commits[0]!.parent_id).toBeNull();
    expect(main.commits[0]!.tick).toBe(0);
    expect(main.inputs).toHaveLength(0);
    expect(main.keyframes).toHaveLength(1);
    expect(h.substrate.read.tick).toBe(0);
  });

  test("commit payload captures the post-tick state", () => {
    const h = build();
    historyTick(h, { dir: 1 });
    const c = historyActiveBranch(h).commits[1]!;
    expect(c.payload.tick).toBe(1);
    expect(c.payload.pos).toBe(1);
    expect(c.payload.heading).toBe(1);
  });
});

describe("historyStateAt — replay from keyframe + lineage", () => {
  test("state_at on active head is the fast path (no-op)", () => {
    const h = build();
    for (const dir of MIXED) historyTick(h, { dir });
    const head_tick = historyActiveBranch(h).head_tick;
    const before = deepCloneState(h.substrate.read);
    const restored = historyStateAt(h, "main", head_tick);
    expect(diffState(restored, before)).toBeNull();
  });

  test("state_at(K) reconstructs the state captured at tick K", () => {
    const h = build({ keyframe_period: 5 });
    const checkpoints: Record<number, ToyState> = {};
    for (let i = 0; i < MIXED.length; i++) {
      checkpoints[h.substrate.read.tick] = deepCloneState(h.substrate.read);
      historyTick(h, { dir: MIXED[i]! });
    }
    checkpoints[h.substrate.read.tick] = deepCloneState(h.substrate.read);

    for (const tickStr of Object.keys(checkpoints)) {
      const tick = Number(tickStr);
      const restored = historyStateAt(h, "main", tick);
      const diff = diffState(restored, checkpoints[tick]!);
      expect(diff, `mismatch at tick ${tick}: ${diff}`).toBeNull();
    }
  });

  test("keyframe_period is a pure cache — Infinity vs 1 give identical state_at", () => {
    const hSparse = build({ keyframe_period: Number.POSITIVE_INFINITY });
    const hDense = build({ keyframe_period: 1 });
    for (const dir of MIXED) {
      historyTick(hSparse, { dir });
      historyTick(hDense, { dir });
    }
    for (let t = 0; t <= MIXED.length; t++) {
      const sparse = historyStateAt(hSparse, "main", t);
      const dense = historyStateAt(hDense, "main", t);
      const diff = diffState(sparse, dense);
      expect(diff, `tick ${t}: ${diff}`).toBeNull();
    }
  });

  test("keyframe restore preserves all typed-array subtypes (regression)", () => {
    // an `Int32Array` field was once keyframed as a plain
    // object (the clone helper only handled Float32 + Uint8), so the tick
    // after a rewind crashed with `set is not a function`. The toy's
    // `steps: Int32Array` exercises the same path.
    const h = build({ keyframe_period: 5 });
    for (let i = 0; i < MIXED.length; i++) historyTick(h, { dir: MIXED[i]! });
    // Rewind to a tick before the first keyframe — forces a keyframe-restore
    // through the typed-array clone helpers.
    historyStateAt(h, "main", 2);
    expect(h.substrate.read.tick).toBe(2);
    // Tick forward again — the call site that crashed pre-fix.
    expect(() => historyTick(h, { dir: 1 })).not.toThrow();
    // And `steps` survived as a proper Int32Array, not a plain object.
    expect(h.substrate.read.steps).toBeInstanceOf(Int32Array);
  });
});

describe("historyBranchFrom + historySetActiveBranch", () => {
  test("branch_from creates an empty branch at the fork tick", () => {
    const h = build();
    for (let i = 0; i < 6; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 3, "side");
    const side = h.branches["side"]!;
    expect(side.parent_branch_id).toBe("main");
    expect(side.fork_tick).toBe(3);
    expect(side.head_tick).toBe(3);
    expect(side.inputs).toHaveLength(0);
    expect(side.commits).toHaveLength(0);
  });

  test("state_at(side, fork_tick) === state_at(main, fork_tick)", () => {
    const h = build();
    for (let i = 0; i < 8; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 4, "side");
    const onMain = deepCloneState(historyStateAt(h, "main", 4));
    const onSide = historyStateAt(h, "side", 4);
    expect(diffState(onMain, onSide)).toBeNull();
  });

  test("ticks on a switched-to branch advance independently from main", () => {
    const h = build();
    for (let i = 0; i < 6; i++) historyTick(h, { dir: MIXED[i]! });
    const main_head_tick = historyActiveBranch(h).head_tick;
    historyBranchFrom(h, "main", 3, "side");
    historySetActiveBranch(h, "side");
    expect(h.substrate.read.tick).toBe(3);

    historyTick(h, { dir: 1 });
    historyTick(h, { dir: -1 });
    const side = h.branches["side"]!;
    expect(side.head_tick).toBe(5);
    expect(side.inputs).toHaveLength(2);

    // main is untouched by the side branch's ticks.
    const main = h.branches["main"]!;
    expect(main.head_tick).toBe(main_head_tick);
    expect(main.inputs).toHaveLength(6);
  });

  test("set_active_branch re-anchors substrate to that branch's head", () => {
    const h = build();
    for (let i = 0; i < 6; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 2, "side");
    historySetActiveBranch(h, "side");
    historyTick(h, { dir: 1 });
    const side_head = deepCloneState(h.substrate.read);

    historySetActiveBranch(h, "main");
    expect(h.substrate.read.tick).toBe(6);

    historySetActiveBranch(h, "side");
    expect(h.substrate.read.tick).toBe(3);
    expect(diffState(h.substrate.read, side_head)).toBeNull();
  });
});

describe("historyTruncate", () => {
  test("cascade slices the target branch", () => {
    const h = build();
    for (let i = 0; i < 8; i++) historyTick(h, { dir: MIXED[i]! });
    historyTruncate(h, "main", 4);
    const main = h.branches["main"]!;
    expect(main.head_tick).toBe(4);
    expect(main.inputs).toHaveLength(4);
    for (const c of main.commits) expect(c.tick).toBeLessThanOrEqual(4);
    // Substrate re-anchored to the truncation point.
    expect(h.substrate.read.tick).toBe(4);
  });

  test("cascade deletes descendant branches forked past the cut", () => {
    const h = build();
    for (let i = 0; i < 8; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 6, "side");
    historyBranchFrom(h, "main", 3, "early");
    historyTruncate(h, "main", 4);
    expect(h.branches["main"]).toBeDefined();
    expect(h.branches["side"]).toBeUndefined(); // forked at 6 > 4 → cascaded
    expect(h.branches["early"]).toBeDefined(); // forked at 3 ≤ 4 → kept
  });

  test("cascade is transitive", () => {
    const h = build();
    for (let i = 0; i < 8; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 6, "side");
    historySetActiveBranch(h, "side");
    historyTick(h, { dir: 1 });
    historyBranchFrom(h, "side", 7, "subside");
    historySetActiveBranch(h, "main");
    historyTruncate(h, "main", 4);
    expect(h.branches["side"]).toBeUndefined();
    expect(h.branches["subside"]).toBeUndefined();
  });

  test("historyDescendantsForkedPast reports the branches a truncate would cascade", () => {
    const h = build();
    for (let i = 0; i < 6; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 5, "side");
    // The guard a "no take-backs" caller writes in place of a RESTRICT policy:
    // inspect first, then decline if the result is non-empty.
    expect(historyDescendantsForkedPast(h, "main", 3)).toContain("side");
    // The query is advisory — truncating anyway cascades the descendant.
    historyTruncate(h, "main", 3);
    expect(h.branches["side"]).toBeUndefined();
  });

  test("historyDescendantsForkedPast is empty when nothing forks past the cut", () => {
    const h = build();
    for (let i = 0; i < 6; i++) historyTick(h, { dir: MIXED[i]! });
    expect(historyDescendantsForkedPast(h, "main", 3)).toEqual([]);
    historyTruncate(h, "main", 3);
    expect(h.branches["main"]!.head_tick).toBe(3);
  });

  test("active-branch truncate re-anchors substrate even when scrubbed elsewhere", () => {
    const h = build();
    for (let i = 0; i < 8; i++) historyTick(h, { dir: MIXED[i]! });
    // Scrub somewhere else first.
    historyStateAt(h, "main", 2);
    historyTruncate(h, "main", 5);
    expect(h.substrate.read.tick).toBe(5);
    expect(h.branches["main"]!.head_tick).toBe(5);
  });
});

describe("historyLineageCommits", () => {
  test("walks parent chain in temporal order", () => {
    const h = build();
    for (let i = 0; i < 8; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 4, "side");
    historySetActiveBranch(h, "side");
    historyTick(h, { dir: 1 });
    historyTick(h, { dir: -1 });

    const lineage = historyLineageCommits(h, "side");
    const ticks = lineage.map((c) => c.tick);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
    for (const c of lineage) {
      if (c.branch_id === "main") expect(c.tick).toBeLessThanOrEqual(4);
    }
  });
});

describe("historyListBranches", () => {
  test("returns all created branches", () => {
    const h = build();
    for (let i = 0; i < 4; i++) historyTick(h, { dir: MIXED[i]! });
    historyBranchFrom(h, "main", 2, "side");
    historyBranchFrom(h, "main", 3, "other");
    const ids = historyListBranches(h)
      .map((b) => b.id)
      .sort();
    expect(ids).toEqual(["main", "other", "side"]);
  });
});
