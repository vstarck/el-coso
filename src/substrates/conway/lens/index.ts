/* Conway lens — a lens against the contract. Autonomous (no
 * player input); the rAF loop drives ticks at a configurable rate. The
 * substrate is wrapped on both axes, so pan keeps revealing fresh slices
 * of the same toroidal world. Phase 1 of the migration — phase 2 lifts
 * the canvas to HUD-overlay layout and wires real pan drag.
 */

import {
  historyAdvance,
  historyAnnotate,
  historyTick,
} from "@/history";
import {
  COMMIT_PERIOD as CONWAY_COMMIT_PERIOD,
  snapshotConway,
  type ConwayCommitPayload,
  type ConwayConfig,
  type ConwayInputs,
  type SubstrateState,
} from "../engine";
import type { Params, SpeedOption } from "@/lib/types";
import { attachCanvasSizing } from "@/lib/canvas/sizing";
import { attachPanDrag } from "@/lib/canvas/pan-drag";
import type {
  Cadence,
  CommitGlyph,
  EmbedCommandSpec,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  OutcomeBanner,
  TunableValue,
  ViewportInset,
} from "@/lenses/types";
import { withConsole } from "@/lenses/withConsole";
import { drawConwayFrame } from "./render";

const CELL_PX = 12;

// Reference alive_count for the vitality heatmap. log10(alive)/log10(REF)
// is mapped onto hue 240→0 (blue cool → red hot), clamped at 1. 500 is
// tuned by feel: r-pentomino on a 240×180 torus spends most of its
// life in the 100–300 band, which lands across the blue→orange middle
// of the gradient — readable variation per commit. Denser puzzles
// (random-density on a big grid) saturate to red.
const VITALITY_REF = 500;

const SPEEDS: SpeedOption[] = [
  { id: "0.25x", label: "¼x", mult: 0.25 },
  { id: "0.5x",  label: "½x", mult: 0.5  },
  { id: "1x",    label: "1x", mult: 1,    isDefault: true },
  { id: "2x",    label: "2x", mult: 2    },
  { id: "4x",    label: "4x", mult: 4    },
];

// Cadence — Conway is autonomous: the lens ticks at a steady rate while
// playing, never auto-pauses, and any "bias" (none today) would apply
// immediately. Distinct from a turn-based cadence.
const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

type LensState = {
  cell_color: string;
  show_tick_counter: string;
};

const TUNABLES: LensTunable[] = [
  { id: "show_tick_counter", group: "Lens", label: "Generation overlay", type: "enum", options: ["true", "false"], target: "lens", path: ["show_tick_counter"] },
];

// Stampable patterns for the `spawn` console command — cell offsets from the
// top-left origin the player names.
const PATTERNS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  block: [[0, 0], [1, 0], [0, 1], [1, 1]],
  blinker: [[0, 0], [1, 0], [2, 0]],
};

// Console command surface (spec/25). The guake console (wired via withConsole
// at the bottom) reads this for `help` + Tab-completion and dispatches each
// line through the MountedLens `command` below. These are conway's OWN verbs —
// real input into the substrate that edits the live state. Transport
// (play/pause/step) + `set <tunable>` come for free as console built-ins
// (spec/26 registry), so they're deliberately not declared here.
const COMMAND_SPECS: EmbedCommandSpec[] = [
  { name: "clear", label: "kill every cell" },
  { name: "random", label: "seed a random soup", args: [{ name: "density", type: "number" }] },
  {
    name: "spawn",
    label: "stamp glider|block|blinker at x y",
    args: [
      { name: "pattern", type: "string" },
      { name: "x", type: "number" },
      { name: "y", type: "number" },
    ],
  },
];

function mountConway(
  args: LensMountArgs<
    SubstrateState,
    ConwayConfig,
    ConwayInputs,
    ConwayCommitPayload
  >,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;
  const config = history.config;

  // Spec/15: lens owns its host element. Append a full-bleed canvas
  // inside the chrome-supplied container.
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.setAttribute("aria-label", "substrate");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on conway canvas");

  // Canvas backing buffer follows the element's CSS box. The world is
  // bigger than the viewport (by design — see r-pentomino-large.json);
  // panning navigates inside it. The resize hook re-centers the pan so
  // the user doesn't lose their place when the viewport changes size.
  const sizing = attachCanvasSizing(canvas, {
    onResize: (c, prev) => {
      pan.x += (c.width - prev.w) / 2;
      pan.y += (c.height - prev.h) / 2;
    },
  });

  // Pan in world-pixel space — `pan.x = 0` puts the world's (0, 0) at
  // the viewport's top-left. Initial offset centers the world on the
  // viewport so the seed pattern is visible at load.
  const pan = { x: 0, y: 0 };
  function centerPan(): void {
    pan.x = (config.W * CELL_PX - canvas.width) / 2;
    pan.y = (config.H * CELL_PX - canvas.height) / 2;
  }
  centerPan();

  // Middle-mouse drag (or shift+left) to pan. rAF picks up the new pan
  // each frame, so no onPan callback is needed.
  const panDrag = attachPanDrag(canvas, { pan });

  // Viewport inset (SAFE_AREA feature). Chrome pushes the visible-rect
  // inset whenever a panel opens/closes; the renderer dodges those edges
  // when placing the tick counter.
  let viewport_inset: ViewportInset = { top: 16, right: 16, bottom: 16, left: 16 };
  const unsubscribeViewport = args.subscribeViewport((inset) => {
    viewport_inset = inset;
  });

  const lens_state: LensState = {
    cell_color: "#9cf",
    show_tick_counter: "true",
  };
  const tunableListeners = new Set<() => void>();
  function notifyTunables(): void {
    for (const cb of tunableListeners) cb();
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0]!;
    if (!(key in lens_state)) return undefined;
    const v = (lens_state as unknown as Record<string, unknown>)[key];
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      return v;
    }
    return undefined;
  }
  function setTunable(path: string[], value: TunableValue): void {
    if (path.length !== 1) return;
    const key = path[0]!;
    if (!(key in lens_state)) return;
    (lens_state as unknown as Record<string, unknown>)[key] = value;
    notifyTunables();
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => {
      tunableListeners.delete(listener);
    };
  }

  // The host's `playing` flag is the source of truth — the rAF loop reads
  // it each frame and ticks iff it's true. Lens-side pause/resume just write
  // to it; halt-detection writes it too. Any transport surface (chrome's
  // play button, an embed toggle) drives the same flag, so they never
  // desync.
  let speed_mult = 1;

  // Stale detection — pauses the loop the moment the evolution falls into
  // a period-1 (still-life) or period-2 (oscillator) cycle, so the player
  // doesn't watch the rAF spin on a state that will never change again.
  // Higher-period detection is the halting-problem edge of GoL; bounded
  // 1- and 2-step memory catches the cheap cases.
  let prev_cells: Uint8Array | null = null;
  let prev2_cells: Uint8Array | null = null;

  function cellsEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function checkStale(): boolean {
    const cur = history.substrate.read.cells;
    if (prev_cells && cellsEqual(cur, prev_cells)) return true;
    if (prev2_cells && cellsEqual(cur, prev2_cells)) return true;
    return false;
  }

  function rollSnapshot(): void {
    const cur = history.substrate.read.cells;
    if (prev_cells === null) prev_cells = new Uint8Array(cur.length);
    if (prev2_cells === null) prev2_cells = new Uint8Array(cur.length);
    prev2_cells.set(prev_cells);
    prev_cells.set(cur);
  }

  // Cleared whenever the substrate is re-anchored to a non-adjacent
  // state (branch, checkout, scrub-then-play). Without this, a fresh
  // continuation would compare its first new state against pre-branch
  // history and could trigger a false-positive stale.
  function resetStaleMemory(): void {
    prev_cells = null;
    prev2_cells = null;
  }

  function lastCommitHalted(): boolean {
    const active = history.branches[history.active];
    if (!active) return false;
    const last = active.commits[active.commits.length - 1];
    return last?.payload.outcome === "halted";
  }

  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur_tick = history.substrate.read.tick;

    // If we're sitting on a halted head, refuse to tick past it. The
    // user can branch off (when allowed) or rewind further; this lens
    // just won't extend a dead run.
    if (cur_tick >= active.head_tick && lastCommitHalted()) {
      host.setPlaying(false);
      return;
    }

    // Replay mode — the substrate is behind the recorded head. Advance
    // the live substrate by one engine tick *without* appending to
    // inputs / emitting commits. Conway has no per-tick input, so we
    // pass `{}`. This is O(1) keyframe-wise — historyStateAt would
    // restore from the last keyframe and re-replay every frame,
    // averaging ~50× a normal tick within a keyframe period.
    if (cur_tick < active.head_tick) {
      historyAdvance(history, {});
      const nextTick = history.substrate.read.tick;
      host.setPlayheadTick(nextTick);
      // If we just reached the halted endpoint, pause without taking
      // the next live tick.
      if (nextTick >= active.head_tick && lastCommitHalted()) {
        host.setPlaying(false);
      }
      return;
    }

    // Live mode — extending the timeline.
    historyTick(history, {});
    host.setPlayheadTick(history.substrate.read.tick);
    if (history.substrate.read.tick % CONWAY_COMMIT_PERIOD === 0) {
      host.bumpHistoryVersion();
    }
    if (checkStale()) {
      host.setPlaying(false);
      // Mark the end of the line on the timeline so the run's terminus
      // is visible even when it lands between regular commit-period
      // commits. `historyAnnotate` is the lens-tier hook for events the
      // substrate predicate can't see.
      const payload = snapshotConway(history.substrate.read);
      payload.outcome = "halted";
      historyAnnotate(history, payload);
      host.bumpHistoryVersion();
      return;
    }
    rollSnapshot();
  }

  function renderFrom(state: SubstrateState): void {
    drawConwayFrame(state, ctx as CanvasRenderingContext2D, {
      cell_px: CELL_PX,
      pan,
      wrap_x: config.boundary_x === "wrap",
      wrap_y: config.boundary_y === "wrap",
      cell_color: lens_state.cell_color,
      show_tick_counter: lens_state.show_tick_counter === "true",
      inset: viewport_inset,
    });
  }

  function renderThumbnail(state: SubstrateState, target: HTMLCanvasElement): void {
    const tctx = target.getContext("2d");
    if (!tctx) return;
    const cell_px = Math.max(
      1,
      Math.floor(Math.min(target.width / config.W, target.height / config.H)),
    );
    const drawn_w = config.W * cell_px;
    const drawn_h = config.H * cell_px;
    tctx.fillStyle = "#08090b";
    tctx.fillRect(0, 0, target.width, target.height);
    tctx.save();
    tctx.translate(
      Math.floor((target.width - drawn_w) / 2),
      Math.floor((target.height - drawn_h) / 2),
    );
    drawConwayFrame(state, tctx, {
      cell_px,
      pan: { x: 0, y: 0 },
      wrap_x: false,
      wrap_y: false,
      cell_color: lens_state.cell_color,
      show_tick_counter: false,
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    tctx.restore();
  }

  // Conway commits have no direction — just a generation count + alive
  // population. Use a circle whose color reflects "vitality" buckets, so
  // the timeline reads as a heatmap of activity across the run.
  function commitGlyph(payload: Params): CommitGlyph {
    if (payload["outcome"] === "halted") {
      return { kind: "char", char: "🪦" };
    }
    const alive = typeof payload["alive_count"] === "number"
      ? (payload["alive_count"] as number)
      : 0;
    if (alive === 0) return { kind: "circle" };
    // Continuous heatmap via log10 — handles the ~5 to ~25k range a
    // Conway run might span. Cool blue at sparse, hot red at dense.
    const t = Math.min(
      1,
      Math.log10(alive + 1) / Math.log10(VITALITY_REF + 1),
    );
    const hue = 240 * (1 - t);
    return { kind: "disc", color: `hsl(${hue} 70% 60%)` };
  }

  // Conway has no fitness — halting means the system reached equilibrium
  // (still-life or period-2 oscillator). Surface as a "draw" banner; the
  // wording frames it as a discovery rather than a loss.
  function outcomeFor(payload: Params): OutcomeBanner | null {
    if (payload["outcome"] !== "halted") return null;
    const alive = typeof payload["alive_count"] === "number"
      ? (payload["alive_count"] as number)
      : 0;
    return {
      status: "draw",
      title: "Evolution halted",
      body: alive === 0
        ? "Extinction — no live cells remain."
        : `The pattern stabilized at ${alive} live cell${alive === 1 ? "" : "s"}.`,
    };
  }

  // Stamp a named pattern into the live cells, wrapping at the torus edges.
  function stampPattern(name: string, ox: number, oy: number): void {
    const offsets = PATTERNS[name];
    if (!offsets) {
      throw new Error(
        `unknown pattern: ${name} — try ${Object.keys(PATTERNS).join(" / ")}`,
      );
    }
    const cells = history.substrate.read.cells;
    for (const [dx, dy] of offsets) {
      const x = (((ox + dx) % config.W) + config.W) % config.W;
      const y = (((oy + dy) % config.H) + config.H) % config.H;
      cells[y * config.W + x] = 1;
    }
  }

  // Console command dispatch (spec/25). State edits mutate the live read buffer
  // — the rAF render picks them up next frame, no commit needed — and clear the
  // stale-detector so a fresh soup isn't matched against pre-edit memory.
  // Throws on an unknown name; the console surfaces it (never a silent no-op).
  function command(name: string, commandArgs: unknown[]): void {
    switch (name) {
      case "clear":
        history.substrate.read.cells.fill(0);
        resetStaleMemory();
        break;
      case "random": {
        const density = typeof commandArgs[0] === "number"
          ? Math.max(0, Math.min(1, commandArgs[0]))
          : 0.3;
        const cells = history.substrate.read.cells;
        for (let i = 0; i < cells.length; i++) {
          cells[i] = Math.random() < density ? 1 : 0;
        }
        resetStaleMemory();
        break;
      }
      case "spawn": {
        const pattern = typeof commandArgs[0] === "string" ? commandArgs[0] : "glider";
        const x = typeof commandArgs[1] === "number"
          ? Math.floor(commandArgs[1])
          : Math.floor(config.W / 2);
        const y = typeof commandArgs[2] === "number"
          ? Math.floor(commandArgs[2])
          : Math.floor(config.H / 2);
        stampPattern(pattern, x, y);
        resetStaleMemory();
        break;
      }
      default:
        throw new Error(`unknown command: ${name}`);
    }
  }

  return {
    unmount: () => {
      panDrag.detach();
      sizing.detach();
      unsubscribeViewport();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    snapshot: () => canvas,
    renderThumbnail,
    commitGlyph,
    outcomeFor,
    pause: () => {
      host.setPlaying(false);
    },
    resume: () => {
      // resume() is the path bttf.ts uses after branch/checkout — the
      // substrate may have re-anchored to a different lineage, so the
      // stale-detection memory is no longer about *this* state. Clear it
      // to avoid a false-positive match against pre-branch history.
      resetStaleMemory();
      host.setPlaying(true);
    },
    step: () => {
      // Pause first so the next rAF doesn't immediately re-advance past
      // our requested single step.
      host.setPlaying(false);
      doOneTick();
    },
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
    command,
  };
}

const conwayLensBase: Lens<
  SubstrateState,
  ConwayConfig,
  ConwayInputs,
  ConwayCommitPayload
> = {
  id: "conway-grid",
  name: "Cells",
  tunables: TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "canvas2d",
  // AUTOPLAY      — rAF loop drives ticks; play button wired.
  // SINGLE_BRANCH — deterministic + no player input, so a branch from
  //                 tick T re-runs the same evolution. Chrome hides
  //                 the branch button and turns checkout into
  //                 non-destructive "go back here" + replay.
  // SAFE_AREA     — tick counter dodges chrome-published viewport inset.
  features: ["AUTOPLAY", "SINGLE_BRANCH", "SAFE_AREA"],
  // Console command surface — `clear`/`random`/`spawn` edit live state,
  // `step`/`play`/`pause` drive transport (dispatched via the guake console).
  commands: COMMAND_SPECS,
  mount: mountConway,
};

// Conway is the reference adopter of the guake-style command console: backtick
// drops a fish-prompt terminal over the grid for real text input into the
// substrate. The decorator forwards every other lens method to the base.
export const conwayLens = withConsole(conwayLensBase);
