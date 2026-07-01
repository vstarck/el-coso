// Julia's BTTF contract. Per-tick *inputs* are recorded by historyTick
// regardless; this predicate governs commit (timeline node) density.
import type { HistoryAdapter } from "@/history/types";
import type { JuliaInputs, SubstrateState } from "./types";

export const COMMIT_PERIOD = 50;

// The commit carries c so the timeline preview / glyph can reflect where the
// parameter was — the whole substrate state, really.
export type JuliaCommitPayload = {
  tick: number;
  c_re: number;
  c_im: number;
};

export function snapshotJulia(s: SubstrateState): JuliaCommitPayload {
  return { tick: s.tick, c_re: s.c_re, c_im: s.c_im };
}

export const juliaBttfAdapter: HistoryAdapter<
  SubstrateState,
  JuliaInputs,
  JuliaCommitPayload
> = {
  root_commit: (s) => snapshotJulia(s),
  commit_predicate: (before, after, _input) => {
    if (after.tick === 0) return null; // root covers tick 0
    if (after.tick % COMMIT_PERIOD !== 0) return null; // rate-limit
    // A still set (speed 0) never moves c — no morph worth a timeline node.
    if (before.c_re === after.c_re && before.c_im === after.c_im) return null;
    return snapshotJulia(after);
  },
};
