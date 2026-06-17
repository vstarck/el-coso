/* Projection overlay — a prediction of where the particle goes next. v1 ships
 * the NAIVE strategy: constant implicit velocity + kinematic wall reflection
 * against the (known, visible) box, with NO knowledge of gravity or jitter.
 *
 * That blindness is the feature. In a pure-DVD scene the naive ray is correct
 * until a wall or a jitter nudge; flip gravity on and the prediction stays a
 * straight-bounce line while the real path curves away — the lens cannot model
 * the force it cannot see ("the universe doesn't help").
 *
 * `ProjectionStrategy` is the seam: a physics-aware strategy would import the
 * engine's pure `integrateAndReflect` and forward-simulate with jitter
 * disabled. Deferred until a second strategy earns the enum tunable. */

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
  sx,
  sy,
} from "./shared";

export type ProjectionStrategy = (
  state: SubstrateState,
  config: DvdConfig,
  horizon: number,
) => Array<{ x: number; y: number }>;

// Constant velocity, perfect kinematic reflection, no field forces.
export const naiveBallistic: ProjectionStrategy = (state, config, horizon) => {
  const pts: Array<{ x: number; y: number }> = [];
  let x = state.px[0] ?? 0;
  let y = state.py[0] ?? 0;
  let vx = x - (state.ppx[0] ?? 0);
  let vy = y - (state.ppy[0] ?? 0);
  const r = config.radius;
  const lo_x = r;
  const hi_x = config.world_w - r;
  const lo_y = r;
  const hi_y = config.world_h - r;
  for (let k = 0; k < horizon; k++) {
    x += vx;
    y += vy;
    if (x < lo_x) {
      x = 2 * lo_x - x;
      vx = -vx;
    } else if (x > hi_x) {
      x = 2 * hi_x - x;
      vx = -vx;
    }
    if (y < lo_y) {
      y = 2 * lo_y - y;
      vy = -vy;
    } else if (y > hi_y) {
      y = 2 * hi_y - y;
      vy = -vy;
    }
    if (x < lo_x) x = lo_x;
    else if (x > hi_x) x = hi_x;
    if (y < lo_y) y = lo_y;
    else if (y > hi_y) y = hi_y;
    pts.push({ x, y });
  }
  return pts;
};

function mountProjection(
  args: LensMountArgs<SubstrateState, DvdConfig, DvdInputs, DvdCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history } = args;
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.setAttribute("aria-label", "Projection");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on dvd-projection");
  const sizing = attachCanvasSizing(canvas);

  let inset: ViewportInset = { top: 0, right: 0, bottom: 0, left: 0 };
  const unsubscribeViewport = args.subscribeViewport((v) => {
    inset = v;
  });

  let visible = true;
  const strategy: ProjectionStrategy = naiveBallistic;

  function renderFrom(state: SubstrateState): void {
    const c = ctx!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!visible) return;

    const horizon = Math.max(1, Math.floor(history.config.projection_horizon));
    const pts = strategy(state, history.config, horizon);
    if (pts.length === 0) return;

    const t = fitTransform(canvas.width, canvas.height, state.world_w, state.world_h, inset);

    c.strokeStyle = PALETTE.projection;
    c.lineWidth = 1.5;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.moveTo(sx(t, state.px[0] ?? 0), sy(t, state.py[0] ?? 0));
    for (const p of pts) c.lineTo(sx(t, p.x), sy(t, p.y));
    c.stroke();
    c.setLineDash([]);

    // A hollow marker at the predicted landing point (end of horizon).
    const end = pts[pts.length - 1]!;
    c.fillStyle = PALETTE.projection;
    c.globalAlpha = 0.85;
    c.beginPath();
    c.arc(sx(t, end.x), sy(t, end.y), 3, 0, Math.PI * 2);
    c.fill();
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

export const dvdProjectionLens: Lens<
  SubstrateState,
  DvdConfig,
  DvdInputs,
  DvdCommitPayload
> = {
  id: "dvd-projection",
  name: "Projection",
  tunables: [],
  speeds: PASSIVE_SPEEDS,
  cadence: EVERY_FRAME,
  target_kind: "canvas2d",
  features: [],
  theme: { accent: PALETTE.projection },
  mount: mountProjection,
};
