/* Example lens — exercises every kit helper documented in
 * `docs/guide.md`. Reads as a
 * commented walkthrough; copy this file when authoring a real lens and
 * trim the questions that don't apply.
 *
 *   Q1 — render target?    canvas2d (so: attachCanvasSizing)
 *   Q2 — viewport relation? full-bleed perspective (no feature flags)
 *                            SAFE_AREA on for the tick counter.
 *   Q3 — storage shape?    dense (channels) — engine/channels.ts decl.
 *   Q4 — agency?           none — autonomous world, the player only
 *                            observes (Inputs = {}, no input kit).
 *   Q5 — pace?             autonomous (so: expose tick + speedMult;
 *                            the host owns the rAF and drives them)
 *   Q6 — commit shape?     per-50-ticks; payload carries total counter.
 *
 * Plus the cross-cutting interaction kit: attachPanDrag for navigation. */

import { historyAdvance, historyTick } from "@/history";
import type {
  ExampleCommitPayload,
  ExampleConfig,
  ExampleInputs,
  SubstrateState,
} from "../engine";
import type { Params, SpeedOption } from "@/lib/types";
import { attachCanvasSizing } from "@/lib/canvas/sizing";
import { attachPanDrag } from "@/lib/canvas/pan-drag";
import type {
  Cadence,
  CommitGlyph,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  TunableValue,
  ViewportInset,
} from "@/lenses/types";
import { drawExampleFrame } from "./render";

const CELL_PX = 24;

const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x",   label: "1x", mult: 1, isDefault: true },
  { id: "2x",   label: "2x", mult: 2 },
  { id: "4x",   label: "4x", mult: 4 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  {
    id: "show_tick_counter",
    group: "Lens",
    label: "Tick counter",
    type: "enum",
    options: ["true", "false"],
    target: "lens",
    path: ["show_tick_counter"],
  },
];

type LensState = {
  show_tick_counter: string;
};

function mountExample(
  args: LensMountArgs<SubstrateState, ExampleConfig, ExampleInputs, ExampleCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;
  const config = history.config;

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.setAttribute("aria-label", "substrate");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on example canvas");

  // Q1: canvas2d ⇒ attachCanvasSizing.
  const sizing = attachCanvasSizing(canvas, {
    onResize: (c, prev) => {
      pan.x += (c.width - prev.w) / 2;
      pan.y += (c.height - prev.h) / 2;
    },
  });

  // World pan in CSS pixels. Default centers the grid in the viewport.
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

  // Q2: SAFE_AREA on. Subscribe even though the only HUD is the tick
  // counter — fits the contract: declare the feature, consume the
  // channel, dodge the inset.
  let viewport_inset: ViewportInset = { top: 16, right: 16, bottom: 16, left: 16 };
  const unsubscribeViewport = args.subscribeViewport((inset) => {
    viewport_inset = inset;
  });

  const lens_state: LensState = {
    show_tick_counter: "true",
  };
  const tunableListeners = new Set<() => void>();
  function notifyTunables(): void {
    for (const cb of tunableListeners) cb();
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0]!;
    if (key === "show_tick_counter") return lens_state.show_tick_counter;
    return undefined;
  }
  function setTunable(path: string[], value: TunableValue): void {
    if (path.length !== 1) return;
    const key = path[0]!;
    if (key === "show_tick_counter" && typeof value === "string") {
      lens_state.show_tick_counter = value;
      notifyTunables();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => {
      tunableListeners.delete(listener);
    };
  }

  // Q5: autonomous ⇒ expose `tick` + `speedMult` on the MountedLens;
  // the host owns the single rAF and drives them. (Don't call
  // attachRafLoop from a lens.) Reach the host only through `args.host`
  // (the injected LensHost) — never import `@/app/store`, which would
  // break the embed/bare/headless hosts. "Ask, don't read."
  const isPlaying = () => host.isPlaying();
  let speed_mult = 1;

  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur_tick = history.substrate.read.tick;
    if (cur_tick < active.head_tick) {
      historyAdvance(history, {});
      host.setPlayheadTick(history.substrate.read.tick);
      return;
    }
    historyTick(history, {});
    host.setPlayheadTick(history.substrate.read.tick);
    if (history.substrate.read.tick % 50 === 0) {
      host.bumpHistoryVersion();
    }
  }

  function renderFrom(state: SubstrateState): void {
    drawExampleFrame(state, ctx as CanvasRenderingContext2D, {
      cell_px: CELL_PX,
      pan,
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
    tctx.save();
    tctx.translate(
      Math.floor((target.width - drawn_w) / 2),
      Math.floor((target.height - drawn_h) / 2),
    );
    drawExampleFrame(state, tctx, {
      cell_px,
      pan: { x: 0, y: 0 },
      show_tick_counter: false,
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    tctx.restore();
  }

  function commitGlyph(payload: Params): CommitGlyph {
    const total = typeof payload["total"] === "number" ? payload["total"] : 0;
    // Saturate at 5000 (roughly 50 ticks × 100 cells). Cool blue at
    // start, warm amber at saturation.
    const t = Math.min(1, total / 5000);
    const hue = 210 - 180 * t;
    return { kind: "disc", color: `hsl(${hue.toFixed(0)} 70% 60%)` };
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
    pause: () => {
      host.setPlaying(false);
    },
    resume: () => {
      host.setPlaying(true);
    },
    step: () => {
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
  };
}

export const exampleLens: Lens<
  SubstrateState,
  ExampleConfig,
  ExampleInputs,
  ExampleCommitPayload
> = {
  id: "example-grid",
  name: "Grid",
  tunables: TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "canvas2d",
  // AUTOPLAY  — rAF drives ticks (Q5).
  // SAFE_AREA — tick counter dodges chrome-published inset (Q2).
  // SINGLE_BRANCH — deterministic + no input, so replay from any tick.
  features: ["AUTOPLAY", "SAFE_AREA", "SINGLE_BRANCH"],
  theme: { accent: "#9aa3b2" },
  mount: mountExample,
};
