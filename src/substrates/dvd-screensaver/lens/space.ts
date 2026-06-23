/* dvd-space — the base "space" lens of the composite. Renders the space +
 * bouncing particle + fading trail and owns the substrate tick (AUTOPLAY).
 *
 * It knows NOTHING about the overlays or the HUD: composition (child binding,
 * HUD→overlay visibility forwarding, snapshot compositing) is done by
 * `composeSimpleSpace` in lens/index.ts, which decorates this lens's mount.
 * That keeps the order-invariant child recovery in one shared place instead of
 * smeared across this file. */

import { historyAdvance, historyTick } from "@/history";
import { attachCanvasSizing } from "@/lib/canvas/sizing";
import type { Params, SpeedOption } from "@/lib/types";
import type {
  CommitGlyph,
  Lens,
  LensMountArgs,
  LensTunable,
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
  particlePos,
  sx,
  sy,
} from "./shared";

// Default is a calm drift — at every-frame cadence even ¼× reads quick, so the
// scale starts well below 1× and opens an ultra-slow inspection notch.
export const ROOT_SPEEDS: SpeedOption[] = [
  { id: "0.0625x", label: "1⁄16x", mult: 0.0625 },
  { id: "0.125x", label: "⅛x", mult: 0.125, isDefault: true },
  { id: "0.25x", label: "¼x", mult: 0.25 },
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1 },
  { id: "2x", label: "2x", mult: 2 },
];

// All config-tier: the chrome's Rules rail writes these straight into
// history.config (the tick reads gravity/jitter; the projection lens reads
// projection_horizon). Deliberately the "official" knob surface, contrasted
// with the HUD's in-canvas view toggles.
export const ROOT_TUNABLES: LensTunable[] = [
  {
    id: "gravity",
    group: "Physics",
    label: "Gravity",
    type: "float",
    min: -0.4,
    max: 0.4,
    step: 0.005,
    curve: "signed-cubic",
    target: "config",
    path: ["gravity"],
  },
  {
    id: "jitter",
    group: "Physics",
    label: "Jitter",
    type: "float",
    min: 0,
    max: 0.2,
    step: 0.002,
    target: "config",
    path: ["jitter"],
  },
  {
    id: "projection_horizon",
    group: "View",
    label: "Projection horizon",
    type: "int",
    min: 5,
    max: 240,
    step: 5,
    unit: "ticks",
    target: "config",
    path: ["projection_horizon"],
  },
];

const TRAIL_LEN = 64;

export function mountSpace(
  args: LensMountArgs<SubstrateState, DvdConfig, DvdInputs, DvdCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.setAttribute("aria-label", "substrate");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on dvd-space");
  const sizing = attachCanvasSizing(canvas);

  let inset: ViewportInset = { top: 0, right: 0, bottom: 0, left: 0 };
  const unsubscribeViewport = args.subscribeViewport((v) => {
    inset = v;
  });

  // --- lens-side trail memory ------------------------------------------
  const trail: Array<{ x: number; y: number }> = [];
  let last_trail_tick = -1;
  let speed_mult = ROOT_SPEEDS.find((s) => s.isDefault)?.mult ?? 1;

  function renderFrom(state: SubstrateState): void {
    const c = ctx as CanvasRenderingContext2D;
    c.fillStyle = PALETTE.bg;
    c.fillRect(0, 0, canvas.width, canvas.height);

    const t = fitTransform(canvas.width, canvas.height, state.world_w, state.world_h, inset);
    const p = particlePos(state);

    if (state.tick !== last_trail_tick) {
      last_trail_tick = state.tick;
      trail.push({ x: p.x, y: p.y });
      if (trail.length > TRAIL_LEN) trail.shift();
    }

    // fading trail
    if (trail.length > 1) {
      c.lineCap = "round";
      c.strokeStyle = PALETTE.trail;
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]!;
        const b = trail[i]!;
        c.globalAlpha = (i / trail.length) * 0.5;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(sx(t, a.x), sy(t, a.y));
        c.lineTo(sx(t, b.x), sy(t, b.y));
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    // particle
    const r_px = Math.max(2, history.config.radius * t.scale);
    const cx = sx(t, p.x);
    const cy = sy(t, p.y);
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, r_px * 2.4);
    glow.addColorStop(0, PALETTE.particle_glow);
    glow.addColorStop(1, "rgba(56,189,248,0)");
    c.fillStyle = glow;
    c.beginPath();
    c.arc(cx, cy, r_px * 2.4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = PALETTE.particle;
    c.beginPath();
    c.arc(cx, cy, r_px, 0, Math.PI * 2);
    c.fill();
  }

  // Autonomous tick — example/Conway pattern: replay if behind head,
  // otherwise advance, nudging the chrome's playhead + history version.
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

  function commitGlyph(payload: Params): CommitGlyph {
    const speed = typeof payload["speed"] === "number" ? payload["speed"] : 0;
    // cool at rest → warm when fast (saturate around 6 world units/tick)
    const t = Math.min(1, speed / 6);
    const hue = 200 - 160 * t;
    return { kind: "disc", color: `hsl(${hue.toFixed(0)} 75% 60%)` };
  }

  // Base lens returns just its own canvas; `composeSimpleSpace` composites
  // the visible children over it.
  return {
    unmount: () => {
      unsubscribeViewport();
      sizing.detach();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    snapshot: () => canvas,
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
      const opt = ROOT_SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    // Root has no lens-tier tunables (all config-tier, written by the
    // chrome straight to history.config). Stub the surface.
    getTunable: () => undefined,
    setTunable: () => {},
    subscribeTunables: () => () => {},
  };
}

// The base "space" lens. `composeSimpleSpace` (lens/index.ts) inherits this
// identity onto the composite and decorates `mount` with the overlay/HUD
// wiring. Identity lives here (not on the composite) so the composite is pure
// glue.
//   AUTOPLAY — rAF drives the Verlet tick. FLAT — a perspective tilt reads
//   wrong on a clean physics demo. SINGLE_BRANCH — deterministic + zero
//   input, so any tick replays identically. SAFE_AREA — the world fits the
//   un-occluded rect (every layer consumes the published inset; see
//   lens/shared.ts fitTransform).
export const dvdSpaceLens: Lens<
  SubstrateState,
  DvdConfig,
  DvdInputs,
  DvdCommitPayload
> = {
  id: "dvd-screensaver",
  name: "Screensaver",
  tunables: ROOT_TUNABLES,
  speeds: ROOT_SPEEDS,
  cadence: EVERY_FRAME,
  target_kind: "canvas2d",
  features: ["AUTOPLAY", "FLAT", "SINGLE_BRANCH", "SAFE_AREA"],
  theme: { accent: PALETTE.particle_glow },
  mount: mountSpace,
};
