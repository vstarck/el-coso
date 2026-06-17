/* DeckController — the single history-facing surface for Blockoide.
 *
 * The orchestrating deck owns exactly one of these; nothing else in the
 * substrate touches `history`. It bundles the keyboard input source, the
 * replay-aware tick loop, and the transport verbs (rewind / restart /
 * speed). It is deliberately STORE-FREE: it reports state changes through
 * an injected `onChange` callback rather than poking the app store, so the
 * same controller drives both the full-app chrome (which wires onChange to
 * the Zustand store) and the react-less embed host (which wires its own).
 *
 * The host (full-app SubstrateHost or the embed mini-host) owns play/pause
 * gating and calls `doOneTick` from its rAF when playing; the controller
 * only advances when asked.
 */

import {
  historyAdvance,
  historyBranchFrom,
  historyReset,
  historySetActiveBranch,
  historyStateAt,
  historyTick,
  historyTruncate,
} from "@/history";
import type { History } from "@/history";
import type { SpeedOption } from "@/lib/types";
import type { Cadence } from "@/lenses/types";
import { makeAutopilot } from "./autopilot";
import type {
  BlockoideCommitPayload,
  BlockoideConfig,
  BlockoideInputs,
  BlockoideOutcome,
  SubstrateState,
} from "../engine";

export type BlockoideHistory = History<
  SubstrateState,
  BlockoideConfig,
  BlockoideInputs,
  BlockoideCommitPayload
>;

export const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1, isDefault: true },
  { id: "2x", label: "2x", mult: 2 },
  { id: "4x", label: "4x", mult: 4 },
];

export const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const NEUTRAL: BlockoideInputs = {
  move_x: 0,
  move_y: 0,
  rot_x: 0,
  rot_y: 0,
  rot_z: 0,
  soft: false,
  hard: false,
};

function isDiverging(i: BlockoideInputs): boolean {
  return (
    i.move_x !== 0 ||
    i.move_y !== 0 ||
    i.rot_x !== 0 ||
    i.rot_y !== 0 ||
    i.rot_z !== 0 ||
    i.soft ||
    i.hard
  );
}

// --- keyboard input source (store-free) -----------------------------------

type InputSource = {
  drainInputs: () => BlockoideInputs;
  detach: () => void;
};

function makeInputSource(): InputSource {
  const held = { left: false, right: false, up: false, down: false, soft: false };
  const tap_rx: number[] = [];
  const tap_ry: number[] = [];
  const tap_rz: number[] = [];
  let tap_hard = 0;

  function pushTap(q: number[], dir: number): void {
    if (q.length < 2) q.push(dir);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return; // chords belong to the host
    const k = e.key;
    if (k === "ArrowLeft") held.left = true;
    else if (k === "ArrowRight") held.right = true;
    else if (k === "ArrowUp") held.up = true;
    else if (k === "ArrowDown") held.down = true;
    else if (k === "Shift") held.soft = true;
    else if (!e.repeat && (k === "q" || k === "Q")) pushTap(tap_rz, -1);
    else if (!e.repeat && (k === "e" || k === "E")) pushTap(tap_rz, 1);
    else if (!e.repeat && (k === "a" || k === "A")) pushTap(tap_ry, -1);
    else if (!e.repeat && (k === "d" || k === "D")) pushTap(tap_ry, 1);
    else if (!e.repeat && (k === "w" || k === "W")) pushTap(tap_rx, -1);
    else if (!e.repeat && (k === "s" || k === "S")) pushTap(tap_rx, 1);
    else if (!e.repeat && k === "Enter") {
      if (tap_hard < 2) tap_hard += 1;
    } else return;
    e.preventDefault();
  }
  function onKeyUp(e: KeyboardEvent): void {
    const k = e.key;
    if (k === "ArrowLeft") held.left = false;
    else if (k === "ArrowRight") held.right = false;
    else if (k === "ArrowUp") held.up = false;
    else if (k === "ArrowDown") held.down = false;
    else if (k === "Shift") held.soft = false;
  }
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  return {
    drainInputs(): BlockoideInputs {
      const hard = tap_hard > 0;
      if (tap_hard > 0) tap_hard -= 1;
      return {
        move_x: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        move_y: (held.down ? 1 : 0) - (held.up ? 1 : 0),
        rot_x: tap_rx.shift() ?? 0,
        rot_y: tap_ry.shift() ?? 0,
        rot_z: tap_rz.shift() ?? 0,
        soft: held.soft,
        hard,
      };
    },
    detach(): void {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    },
  };
}

// --- the controller -------------------------------------------------------

// Snapshot of what changed — handed to onChange after every advance /
// transport op so the host can sync its playhead, redraw its timeline, and
// stop its rAF when the run is over. (`branched`: a fork was created this
// tick; `reanchored`: rewind/restart moved the read position out of band.)
export type DeckEvent = {
  tick: number;
  head_tick: number;
  outcome: BlockoideOutcome;
  branched: boolean;
  reanchored: boolean;
  autopilot: boolean; // whether the heuristic is currently driving
};

export type DeckController = {
  // The host's rAF tick driver (the lens's `tick`).
  doOneTick: () => void;
  speedMult: () => number;
  setSpeed: (id: string) => void;
  // Destructive take-back: drop the last `ticks` ticks on the active branch
  // and continue live from there (no timeline needed to make sense of it).
  rewindBy: (ticks: number) => void;
  // Fresh deterministic game (same seed ⇒ same piece sequence).
  restart: () => void;
  // The heuristic autopilot: when on, it drives any tick the human leaves
  // neutral; a diverging human keypress hands control back (turns it off).
  setAutopilot: (on: boolean) => void;
  isAutopilot: () => boolean;
  onChange: (cb: (e: DeckEvent) => void) => () => void;
  detach: () => void;
};

export function makeDeckController(
  history: BlockoideHistory,
  opts: { autopilot?: boolean } = {},
): DeckController {
  const input = makeInputSource();
  const autopilot = makeAutopilot(history.config);
  let autopilot_on = opts.autopilot ?? false;
  let speed_mult = 1;
  const listeners = new Set<(e: DeckEvent) => void>();

  function emit(branched: boolean, reanchored: boolean): void {
    const active = history.branches[history.active]!;
    const s = history.substrate.read;
    const e: DeckEvent = {
      tick: s.tick,
      head_tick: active.head_tick,
      outcome: s.outcome,
      branched,
      reanchored,
      autopilot: autopilot_on,
    };
    for (const cb of listeners) cb(e);
  }

  function liveTick(in_: BlockoideInputs): void {
    historyTick(history, in_);
    emit(false, false);
  }

  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur = history.substrate.read.tick;

    // Behind head (replay region): neutral input replays the record forward;
    // a diverging input forks a fresh branch and goes live there.
    if (cur < active.head_tick) {
      const live = input.drainInputs();
      if (!isDiverging(live)) {
        const entry = active.inputs.find((e) => e.tick === cur + 1);
        historyAdvance(history, entry ? entry.input : NEUTRAL);
        emit(false, false);
        return;
      }
      let n = 1;
      while (history.branches[`blk-${n}`]) n++;
      const fork_id = `blk-${n}`;
      historyBranchFrom(history, history.active, cur, fork_id);
      historySetActiveBranch(history, fork_id);
      liveTick(live);
      emit(true, false);
      return;
    }

    // At head: if the run is over, do nothing (the host stops its rAF on the
    // terminal onChange). Otherwise advance live.
    if (history.substrate.read.outcome !== "in_progress") return;
    const human = input.drainInputs();
    if (autopilot_on) {
      // A real human action takes over and disables autopilot ("tap to play");
      // otherwise the heuristic drives this tick.
      if (isDiverging(human)) {
        autopilot_on = false;
        liveTick(human);
      } else {
        liveTick(autopilot.nextInput(history.substrate.read));
      }
      return;
    }
    liveTick(human);
  }

  function rewindBy(ticks: number): void {
    const active = history.branches[history.active]!;
    const target = Math.max(active.fork_tick, history.substrate.read.tick - ticks);
    if (target === active.head_tick && target === history.substrate.read.tick) return;
    historyTruncate(history, history.active, target);
    autopilot.reset(); // the planned piece is gone — replan from the new head
    emit(false, true);
  }

  function restart(): void {
    historyReset(history);
    autopilot.reset();
    emit(false, true);
  }

  return {
    doOneTick,
    speedMult: () => speed_mult,
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    rewindBy,
    restart,
    setAutopilot: (on: boolean) => {
      autopilot_on = on;
      if (on) autopilot.reset();
    },
    isAutopilot: () => autopilot_on,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    detach: () => {
      input.detach();
      listeners.clear();
    },
  };
}
