/* Jitter overlay — isolates the stochastic component of acceleration. Drawn
 * as a shimmer rather than a clean arrow so it reads visually distinct from
 * the acceleration overlay even when, in a pure-DVD scene, the two vectors
 * nearly coincide. Keeps a short lens-side ring buffer of recent per-tick
 * kicks (pushed on tick change), drawn as fading spokes from the particle
 * with the current kick brightest. This is the "unpredictable residual" that
 * makes the naive projection wrong. */

import { attachCanvasSizing } from "@/lib/canvas/sizing";
import type {
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
import {
  EVERY_FRAME,
  fitTransform,
  PALETTE,
  PASSIVE_SPEEDS,
  particlePos,
  sx,
  sy,
} from "./shared";

const KICK_GAIN = 320;
const TRAIL = 16;

function mountJitter(
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
  canvas.setAttribute("aria-label", "Jitter");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on dvd-jitter");
  const sizing = attachCanvasSizing(canvas);

  let inset: ViewportInset = { top: 0, right: 0, bottom: 0, left: 0 };
  const unsubscribeViewport = args.subscribeViewport((v) => {
    inset = v;
  });

  let visible = true;
  // Ring buffer of recent per-tick jitter kicks (world space).
  const kicks: Array<{ x: number; y: number }> = [];
  let last_tick = -1;

  function renderFrom(state: SubstrateState): void {
    const c = ctx!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!visible) return;

    if (state.tick !== last_tick) {
      last_tick = state.tick;
      kicks.push({ x: state.jx[0] ?? 0, y: state.jy[0] ?? 0 });
      if (kicks.length > TRAIL) kicks.shift();
    }

    const t = fitTransform(canvas.width, canvas.height, state.world_w, state.world_h, inset);
    const p = particlePos(state);
    const cx = sx(t, p.x);
    const cy = sy(t, p.y);

    c.lineCap = "round";
    for (let i = 0; i < kicks.length; i++) {
      const k = kicks[i]!;
      const age = i / kicks.length; // 0 oldest → 1 newest
      const alpha = 0.15 + 0.75 * age;
      c.globalAlpha = alpha;
      c.strokeStyle = PALETTE.jitter;
      c.lineWidth = i === kicks.length - 1 ? 2.5 : 1.25;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + k.x * KICK_GAIN * t.scale, cy + k.y * KICK_GAIN * t.scale);
      c.stroke();
    }
    c.globalAlpha = 1;
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
    getTunable: (path) => (path[0] === "visible" ? String(visible) : undefined),
    setTunable: (path, value) => {
      if (path[0] === "visible") visible = value === "true" || value === true;
    },
    subscribeTunables: () => () => {},
  };
}

export const dvdJitterLens: Lens<
  SubstrateState,
  DvdConfig,
  DvdInputs,
  DvdCommitPayload
> = {
  id: "dvd-jitter",
  name: "Jitter",
  tunables: [],
  speeds: PASSIVE_SPEEDS,
  cadence: EVERY_FRAME,
  target_kind: "canvas2d",
  features: [],
  theme: { accent: PALETTE.jitter },
  mount: mountJitter,
};
