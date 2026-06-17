/* Scene stack — the suspend/resume primitive. A stack of
 * `(substrate, lens, history)` frames; the
 * top is ACTIVE (ticking, mounted), the rest are SUSPENDED (state frozen,
 * lens unmounted, history paused). This is the only module that knows a
 * scene stack exists — the engine, history layer, and lens contract are
 * untouched (Invariants 5 + 6).
 *
 * The runtime drives two entrypoints:
 *  - `advanceActiveScene(input)` — the single tick entrypoint a PARENT lens
 *    uses instead of `historyTick`. Ticks the active frame, then inspects
 *    the fresh head commit; a `spawn` payload suspends the parent and
 *    pushes the child.
 *  - `resolveActiveSceneIfTerminal()` — polled by the host each child tick;
 *    when the child terminates it pops, feeds the terminal payload back as
 *    a recorded parent input (the baked memo), and resumes the parent.
 *
 * Replay/scrub/branch/compare NEVER enter here (Invariant 3): they walk the
 * parent input log, where the `resolve_*` input already sits.
 */

import { historyTick, type History } from "@/history";
import { useStore } from "@/app/store";
import { SCENE_DEFS } from "./registry";

/* eslint-disable @typescript-eslint/no-explicit-any */
// One scene-stack frame: a full (substrate, lens, history) triple. `session`
// projects the active frame; the host mounts `lens_id` against `history`.
export type SceneFrame = {
  history: History<any, any, any, any>;
  substrate_id: string;
  puzzle_id: string;
  lens_id: string;
  // The `spawn.kind` that built this frame (looked up in SCENE_DEFS to
  // resolve / integrate on terminal). Absent on the root frame.
  scene_kind?: string;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// Single global stack — there is exactly one player session. Always ≥1
// frame after session init.
const stack: SceneFrame[] = [];

// How long a terminated child holds on screen (showing its result + the
// battle log) before the runtime auto-returns to the parent. The exit
// cutscene plays on top of this.
const TERMINAL_HOLD_MS = 1100;
let terminal_since: number | null = null;

// The active (top) frame — what `session` projects.
export function activeFrame(): SceneFrame {
  const top = stack[stack.length - 1];
  if (!top) throw new Error("scene stack is empty");
  return top;
}

// Stack depth. 1 = root only (no scene suspended).
export function sceneDepth(): number {
  return stack.length;
}

// True while a spawned child scene is the active frame.
export function isSceneChild(): boolean {
  return stack.length > 1;
}

// Reset the stack to a single root frame (called by session.setSubstrate).
export function resetStack(root: SceneFrame): void {
  stack.length = 0;
  stack.push(root);
  terminal_since = null;
}

// Advance the active scene by one input, then inspect the fresh head
// commit. A `spawn` payload suspends the parent (its frame stays on the
// stack, frozen) and pushes the child. Returns whether a scene was entered
// — the caller skips its own post-tick render when true (the host re-mount
// takes over). A leaf substrate (no `spawn` ever emitted) behaves exactly
// as a bare `historyTick`.
export function advanceActiveScene(input: unknown): boolean {
  const frame = activeFrame();
  const before = frame.history.substrate.read.tick;
  historyTick(frame.history, input);
  const after = frame.history.substrate.read.tick;
  if (after === before) return false; // rejected tick — no commit, no spawn

  const branch = frame.history.branches[frame.history.active];
  const head = branch?.commits[branch.commits.length - 1];
  // Only a commit that landed on THIS tick can carry our fresh spawn.
  const spawn =
    head && head.tick === after
      ? (head.payload as { spawn?: { kind: string } }).spawn
      : undefined;
  if (!spawn) return false;

  const def = SCENE_DEFS[spawn.kind];
  if (!def) return false;

  stack.push(def.spawnChild(spawn));
  terminal_since = null;
  const store = useStore.getState();
  store.setPlayheadTick(0); // child starts at tick 0
  store.bumpScene("enter");
  return true;
}

// Polled by the host each child tick (after draining the rAF accumulator).
// No-op unless a child scene is active AND has terminated AND the on-screen
// hold has elapsed; then pop, feed the terminal payload back as a recorded
// parent input (the baked memo), and resume the parent.
export function resolveActiveSceneIfTerminal(): void {
  if (stack.length <= 1) {
    terminal_since = null;
    return;
  }
  const child = stack[stack.length - 1]!;
  const def = child.scene_kind ? SCENE_DEFS[child.scene_kind] : undefined;
  if (!def) return;

  const terminal = def.childTerminal(child.history.substrate.read);
  if (terminal === null) {
    terminal_since = null;
    return;
  }

  const now = performance.now();
  if (terminal_since === null) {
    terminal_since = now; // first frame we saw terminal — start the hold
    return;
  }
  if (now - terminal_since < TERMINAL_HOLD_MS) return;
  terminal_since = null;

  // Pop the child, resume the parent by applying the recorded resolve input.
  stack.pop();
  const parent = activeFrame();
  historyTick(parent.history, def.parentResolveInput(terminal));

  // Promote the resolve commit to a recursive artifact: hang the child's
  // entire history off it (the L0.5 memo level). The
  // child was already played and recorded into `child.history`; rather than
  // discard that on pop, retain it so the timeline can drill into the round.
  // Inert for parent replay — the outcome lives in the parent input log as
  // the `resolve_*` entry, so this never re-runs to reproduce parent state.
  const pbranch = parent.history.branches[parent.history.active];
  const phead = pbranch?.commits[pbranch.commits.length - 1];
  if (phead && phead.tick === parent.history.substrate.read.tick) {
    phead.inner = child.history;
  }

  const store = useStore.getState();
  store.setPlayheadTick(parent.history.substrate.read.tick);
  store.bumpScene("exit");
  store.bumpHistoryVersion();
}
