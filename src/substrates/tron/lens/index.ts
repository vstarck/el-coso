/* Tron lens — the worked example for the Agency design question (Q4,
 * *continuous / held*) and the `attachKeyControls` kit.
 *
 *   Q1 — render target?    canvas2d (so: attachCanvasSizing)
 *   Q2 — viewport relation? full-bleed perspective; SAFE_AREA for the HUD.
 *   Q3 — storage shape?    dense (one doubled occupancy channel).
 *   Q4 — agency?           continuous / held — arrow / WASD set a held
 *                            desired heading, sampled every tick via
 *                            attachKeyControls; bias_apply immediate.
 *   Q5 — pace?             autonomous (expose tick + speedMult; the host
 *                            owns the rAF and drives them).
 *   Q6 — commit shape?     per-12-ticks + a guaranteed terminal-edge
 *                            commit; payload carries outcome + trail size.
 *
 * The load-bearing detail: this is the first AUTOPLAY substrate with
 * recorded per-tick input, so the tick loop samples the *live* held
 * heading only at the live head — in replay mode it re-applies the
 * *recorded* input so a scrub-then-play stays bit-exact. */

import { historyAdvance, historyTick } from "@/history";
import { useStore } from "@/app/store";
import type {
  SubstrateState,
  TronCommitPayload,
  TronConfig,
  TronDir,
  TronInputs,
} from "../engine";
import { COMMIT_PERIOD } from "../engine";
import type { Params, SpeedOption } from "@/lib/types";
import { attachCanvasSizing } from "@/lib/canvas/sizing";
import { attachPanDrag } from "@/lib/canvas/pan-drag";
import { attachKeyControls } from "@/lib/canvas/key-controls";
import type {
  Cadence,
  CommitGlyph,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  OutcomeBanner,
  TunableValue,
  ViewportInset,
} from "@/lenses/types";
import { drawTronFrame } from "./render";

const CELL_PX = 18;
const ACCENT = "#22d3ee";

// Q4: arrow keys + WASD → held desired heading. "none" = nothing held.
const KEYMAP: Record<string, TronDir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

// One tick = one cell move, and the host's `mult: 1` means 60 ticks/sec
// (TARGET_BASELINE_HZ) — far too fast for a grid-mover. Tron's speeds are
// sub-1 so a comfortable default lands around 6 cells/sec (~167ms/move,
// reactable). The labels stay familiar; only the underlying rate is slow.
const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.05 },
  { id: "1x", label: "1x", mult: 0.1, isDefault: true },
  { id: "2x", label: "2x", mult: 0.18 },
  { id: "4x", label: "4x", mult: 0.3 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  // Q4: the held heading enters the very next tick.
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  {
    id: "show_hud",
    group: "Lens",
    label: "Survival HUD",
    type: "enum",
    options: ["true", "false"],
    target: "lens",
    path: ["show_hud"],
  },
];

type LensState = {
  show_hud: string;
};

function mountTron(
  args: LensMountArgs<SubstrateState, TronConfig, TronInputs, TronCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history } = args;
  const config = history.config;

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.setAttribute("aria-label", "tron arena");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on tron canvas");

  // Q1: canvas2d ⇒ attachCanvasSizing.
  const sizing = attachCanvasSizing(canvas, {
    onResize: (c, prev) => {
      pan.x += (c.width - prev.w) / 2;
      pan.y += (c.height - prev.h) / 2;
    },
  });

  const world_w = config.W * CELL_PX;
  const world_h = config.H * CELL_PX;
  const pan = { x: 0, y: 0 };
  function centerPan(): void {
    pan.x = (world_w - canvas.width) / 2;
    pan.y = (world_h - canvas.height) / 2;
  }
  centerPan();

  // Cross-cutting: pan-drag for middle-mouse / shift+left.
  const panDrag = attachPanDrag(canvas, { pan });

  // Q4: held-heading input. The lens owns the keymap; the kit owns the
  // event surface and exposes current() to sample at the tick boundary.
  const keys = attachKeyControls<TronDir | "none">({
    keymap: KEYMAP,
    neutral: "none",
    // Tap buffer so a quick two-press U-turn (e.g. up→left while going
    // right) isn't lost between ticks — drained one turn per tick. Set
    // above the slowest speed's tick interval (½x ≈ 333ms) so a legit
    // press is never expired before the next tick samples it; the queue
    // cap (3) — not this window — is what bounds macro buildup.
    bufferMs: 360,
  });

  // Q2: SAFE_AREA — the HUD dodges chrome panels.
  let viewport_inset: ViewportInset = { top: 16, right: 16, bottom: 16, left: 16 };
  const unsubscribeViewport = args.subscribeViewport((inset) => {
    viewport_inset = inset;
  });

  const lens_state: LensState = { show_hud: "true" };
  const tunableListeners = new Set<() => void>();
  function notifyTunables(): void {
    for (const cb of tunableListeners) cb();
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    if (path[0] === "show_hud") return lens_state.show_hud;
    return undefined;
  }
  function setTunable(path: string[], value: TunableValue): void {
    if (path.length !== 1) return;
    if (path[0] === "show_hud" && typeof value === "string") {
      lens_state.show_hud = value;
      notifyTunables();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => {
      tunableListeners.delete(listener);
    };
  }

  // Q5: autonomous ⇒ expose tick + speedMult; the host owns the rAF.
  // Default to the "1x" rate (~6 cells/sec) so the player can react.
  let speed_mult = 0.1;

  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur = history.substrate.read.tick;

    // Replay mode (scrubbed behind the head): re-apply the *recorded*
    // input for the next tick, not the live held heading — otherwise a
    // scrub-then-play diverges from the timeline.
    if (cur < active.head_tick) {
      const entry = active.inputs.find((e) => e.tick === cur + 1);
      historyAdvance(history, entry ? entry.input : { desired: "none" });
      useStore.getState().setPlayheadTick(history.substrate.read.tick);
      return;
    }

    // Live head. The run is over once terminal — halt autoplay so tick
    // stops growing and the head rests on the win/crash commit.
    if (history.substrate.read.outcome !== "in_progress") {
      useStore.getState().setPlaying(false);
      return;
    }

    // Q4: drain the next buffered turn (falling back to the held heading)
    // and record it as this tick's input.
    historyTick(history, { desired: keys.next() });
    const st = history.substrate.read;
    useStore.getState().setPlayheadTick(st.tick);
    if (st.tick % COMMIT_PERIOD === 0 || st.outcome !== "in_progress") {
      useStore.getState().bumpHistoryVersion();
    }
  }

  function renderFrom(state: SubstrateState): void {
    drawTronFrame(state, ctx as CanvasRenderingContext2D, {
      cell_px: CELL_PX,
      pan,
      accent: ACCENT,
      survive_ticks: config.survive_ticks,
      show_hud: lens_state.show_hud === "true",
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
    tctx.save();
    tctx.translate(
      Math.floor((target.width - drawn_w) / 2),
      Math.floor((target.height - drawn_h) / 2),
    );
    drawTronFrame(state, tctx, {
      cell_px,
      pan: { x: 0, y: 0 },
      accent: ACCENT,
      survive_ticks: config.survive_ticks,
      show_hud: false,
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    tctx.restore();
  }

  function commitGlyph(payload: Params): CommitGlyph {
    const outcome = payload["outcome"];
    if (outcome === "won") return { kind: "char", char: "🏁" };
    if (outcome === "lost") return { kind: "char", char: "💥" };
    const filled = typeof payload["filled"] === "number" ? payload["filled"] : 0;
    const t = Math.min(1, filled / 200);
    return { kind: "disc", color: `hsl(190 80% ${(40 + 30 * t).toFixed(0)}%)` };
  }

  function outcomeFor(payload: Params): OutcomeBanner | null {
    const outcome = payload["outcome"];
    if (outcome === "won") {
      return {
        status: "won",
        title: "Survived",
        body: "Your light-cycle outlasted the clock.",
      };
    }
    if (outcome === "lost") {
      return {
        status: "lost",
        title: "Crashed",
        body: "You drove into a wall — your own trail or the arena border.",
      };
    }
    return null;
  }

  return {
    unmount: () => {
      panDrag.detach();
      keys.detach();
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
      useStore.getState().setPlaying(false);
    },
    resume: () => {
      useStore.getState().setPlaying(true);
    },
    step: () => {
      useStore.getState().setPlaying(false);
      doOneTick();
    },
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
  };
}

export const tronLens: Lens<
  SubstrateState,
  TronConfig,
  TronInputs,
  TronCommitPayload
> = {
  id: "tron-arena",
  name: "Arena",
  tunables: TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "canvas2d",
  // AUTOPLAY  — rAF drives ticks (Q5).
  // SAFE_AREA — survival HUD dodges chrome-published inset (Q2).
  // (No SINGLE_BRANCH — the run carries recorded per-tick input.)
  features: ["AUTOPLAY", "SAFE_AREA"],
  theme: { accent: ACCENT },
  mount: mountTron,
};
