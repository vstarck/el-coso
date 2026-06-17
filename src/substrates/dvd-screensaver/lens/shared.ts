/* Shared lens helpers for the dvd-screensaver composite: the world→screen
 * fit transform, the palette every layer agrees on, an arrow drawer, and the
 * `createVectorOverlay` factory that the velocity + acceleration overlays are
 * built from (they differ only by color, gain, and which vector they read).
 *
 * Package-internal DRY, not a kit extraction — the factory exists because two
 * overlays in THIS package are genuinely identical in shape. */

import { attachCanvasSizing } from "@/lib/canvas/sizing";
import type { SpeedOption } from "@/lib/types";
import type {
  Cadence,
  Lens,
  LensMountArgs,
  MountedLens,
  ViewportInset,
} from "@/lenses/types";
import type {
  DvdCommitPayload,
  DvdConfig,
  DvdInputs,
  SubstrateState,
} from "../engine";

export const PALETTE = {
  bg: "#0b0d12",
  particle: "#f8fafc",
  particle_glow: "#38bdf8",
  trail: "#8895a8", // muted slate — distinct from the cyan projection line

  velocity: "#4ade80", // green
  acceleration: "#f87171", // red
  jitter: "#c084fc", // purple
  projection: "#22d3ee", // cyan
  hud_text: "#e2e8f0",
  hud_off: "#475569",
} as const;

// Passive overlay/HUD lenses share these: no real speed control, render every
// frame, no bias timing. (Only the root lens carries meaningful speeds.)
export const PASSIVE_SPEEDS: SpeedOption[] = [
  { id: "passive", label: "passive", mult: 1, isDefault: true },
];

export const EVERY_FRAME: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

// Uniform-scale letterbox fit of the continuous world into a canvas. When an
// `inset` is supplied (SAFE_AREA), the world is fit into — and centered within
// — the un-occluded rect, so the particle never travels behind chrome panels.
// Every layer passes the same inset so their transforms stay in lockstep.
export type Transform = { scale: number; ox: number; oy: number };

export function fitTransform(
  canvas_w: number,
  canvas_h: number,
  world_w: number,
  world_h: number,
  inset?: ViewportInset,
): Transform {
  const top = inset?.top ?? 0;
  const right = inset?.right ?? 0;
  const bottom = inset?.bottom ?? 0;
  const left = inset?.left ?? 0;
  const avail_w = Math.max(1, canvas_w - left - right);
  const avail_h = Math.max(1, canvas_h - top - bottom);
  const scale = Math.min(avail_w / world_w, avail_h / world_h);
  return {
    scale,
    ox: left + (avail_w - world_w * scale) / 2,
    oy: top + (avail_h - world_h * scale) / 2,
  };
}

export function sx(t: Transform, wx: number): number {
  return t.ox + wx * t.scale;
}
export function sy(t: Transform, wy: number): number {
  return t.oy + wy * t.scale;
}

// Particle 0's world position / implicit Verlet velocity — every lens reads
// the same minimal state and reconstructs from it.
export function particlePos(s: SubstrateState): { x: number; y: number } {
  return { x: s.px[0] ?? 0, y: s.py[0] ?? 0 };
}
export function particleVel(s: SubstrateState): { x: number; y: number } {
  return { x: (s.px[0] ?? 0) - (s.ppx[0] ?? 0), y: (s.py[0] ?? 0) - (s.ppy[0] ?? 0) };
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(10, len * 0.4);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  // arrowhead
  const ax = x1 - ux * head;
  const ay = y1 - uy * head;
  const nx = -uy;
  const ny = ux;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(ax + nx * head * 0.5, ay + ny * head * 0.5);
  ctx.lineTo(ax - nx * head * 0.5, ay - ny * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

// A passive overlay that draws one arrow from the particle along a vector it
// reads from state. The shared `visible` tunable (driven by the root, which
// reads the HUD) gates rendering: when off it clears its own canvas and
// returns. This is the body the velocity + acceleration overlays share.
export type VectorOverlaySpec = {
  id: string;
  name: string;
  color: string;
  gain: number; // world-space multiplier so small vectors stay visible
  vector: (s: SubstrateState) => { x: number; y: number };
};

export function createVectorOverlay(
  spec: VectorOverlaySpec,
): Lens<SubstrateState, DvdConfig, DvdInputs, DvdCommitPayload> {
  function mount(
    args: LensMountArgs<SubstrateState, DvdConfig, DvdInputs, DvdCommitPayload>,
  ): MountedLens<SubstrateState> {
    const { container } = args;
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("aria-label", spec.name);
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`could not acquire 2d context on ${spec.id}`);
    const sizing = attachCanvasSizing(canvas);

    let inset: ViewportInset = { top: 0, right: 0, bottom: 0, left: 0 };
    const unsubscribeViewport = args.subscribeViewport((v) => {
      inset = v;
    });

    let visible = true;

    function renderFrom(state: SubstrateState): void {
      const c = ctx!;
      c.clearRect(0, 0, canvas.width, canvas.height);
      if (!visible) return;
      const t = fitTransform(canvas.width, canvas.height, state.world_w, state.world_h, inset);
      const p = particlePos(state);
      const v = spec.vector(state);
      const x0 = sx(t, p.x);
      const y0 = sy(t, p.y);
      const x1 = sx(t, p.x + v.x * spec.gain);
      const y1 = sy(t, p.y + v.y * spec.gain);
      drawArrow(c, x0, y0, x1, y1, spec.color, 3);
    }

    return {
      unmount: () => {
        sizing.detach();
        unsubscribeViewport();
        if (canvas.parentNode === container) container.removeChild(canvas);
      },
      renderFrom,
      snapshot: () => canvas,
      commitGlyph: () => ({ kind: "circle" }),
      pause: () => {},
      resume: () => {},
      step: () => {},
      setSpeed: () => {},
      // The root forwards HUD visibility here via setTunable(["visible"], …).
      getTunable: (path) => (path[0] === "visible" ? String(visible) : undefined),
      setTunable: (path, value) => {
        if (path[0] === "visible") visible = value === "true" || value === true;
      },
      subscribeTunables: () => () => {},
    };
  }

  return {
    id: spec.id,
    name: spec.name,
    tunables: [],
    speeds: PASSIVE_SPEEDS,
    cadence: EVERY_FRAME,
    target_kind: "canvas2d",
    features: [],
    theme: { accent: spec.color },
    mount,
  };
}
