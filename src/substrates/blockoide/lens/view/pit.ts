/* Pit center-view — the classic Blockout 3D view. A perspective wireframe
 * shaft seen from the opening, with settled blocks + the falling piece drawn
 * as depth-sorted, back-face-culled cubes and a white landing ghost on the
 * floor. canvas2d; the view owns its projection.
 *
 * Extracted from the former `blockoide-pit` lens — render half only.
 */

import type { LensTunable, TunableValue } from "@/lenses/types";
import {
  drawCube,
  makeProjector,
  type Pt,
  type Projector,
} from "@/lib/canvas/3d";
import type { BlockoideConfig, SubstrateState } from "../../engine";
import { collides, pieceCells, WALL } from "../../engine";
import type { CenterView } from "./types";

export const CANVAS_PX = 520;
const HUES = [195, 30, 280, 145, 50, 5, 320];
export const TILTS: Record<string, number> = {
  flat: 0.0,
  angled: 0.08,
  steep: 0.16,
};
// The falling piece draws translucent so settled cubes (and its own deeper
// cubes) read through it — just enough to see the cells below.
const PIECE_ALPHA = 0.62;
// Outline width for the falling piece in "ghost" style (a touch heavier than
// the white landing ghost so the live piece reads as the foreground).
const PIECE_WIRE_WIDTH = 2;

export const PIT_TUNABLES: LensTunable[] = [
  {
    id: "tilt",
    group: "Lens",
    label: "Look-into",
    type: "enum",
    options: Object.keys(TILTS),
    target: "lens",
    path: ["tilt"],
  },
  {
    id: "ghost",
    group: "Lens",
    label: "Landing ghost",
    type: "enum",
    options: ["true", "false"],
    target: "lens",
    path: ["ghost"],
  },
  {
    // Render the falling piece as a colored wireframe outline (like the landing
    // ghost) instead of translucent solid cubes — a test of whether the bare
    // cell edges make the 3D shape read more clearly.
    id: "piece",
    group: "Lens",
    label: "Falling piece",
    type: "enum",
    options: ["solid", "ghost"],
    target: "lens",
    path: ["piece"],
  },
];

function clampLight(v: number): number {
  return Math.round(v < 6 ? 6 : v > 96 ? 96 : v);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
}
function cellColor(v: number, light: number): string {
  if (v === WALL) return `hsl(220 10% ${clampLight(light)}%)`;
  return `hsl(${HUES[v - 1] ?? 210} 70% ${clampLight(light)}%)`;
}

export function drawWireframe(
  ctx: CanvasRenderingContext2D,
  P: Projector,
  W: number,
  D: number,
  H: number,
): void {
  const line = (a: Pt, b: Pt) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  ctx.lineWidth = 1;
  // Depth rings (cross-section frame at each z); rim + floor a touch brighter.
  for (let z = 0; z <= H; z++) {
    const edge = z === 0 || z === H;
    ctx.strokeStyle = edge ? "rgba(120,160,235,0.6)" : "rgba(96,130,210,0.22)";
    const ring = [P(0, 0, z), P(W, 0, z), P(W, D, z), P(0, D, z)];
    ctx.beginPath();
    ctx.moveTo(ring[0]!.x, ring[0]!.y);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.y);
    ctx.closePath();
    ctx.stroke();
  }
  // Receding wall lines at each cell boundary.
  ctx.strokeStyle = "rgba(96,130,210,0.3)";
  for (let x = 0; x <= W; x++) {
    line(P(x, 0, 0), P(x, 0, H));
    line(P(x, D, 0), P(x, D, H));
  }
  for (let y = 0; y <= D; y++) {
    line(P(0, y, 0), P(0, y, H));
    line(P(W, y, 0), P(W, y, H));
  }
  // Floor interior grid.
  ctx.strokeStyle = "rgba(96,130,210,0.4)";
  for (let x = 1; x < W; x++) line(P(x, 0, H), P(x, D, H));
  for (let y = 1; y < D; y++) line(P(0, y, H), P(W, y, H));
}

type CubeItem = { x: number; y: number; z: number; v: number; bright: boolean };

function drawScene(
  ctx: CanvasRenderingContext2D,
  s: SubstrateState,
  cw: number,
  ch: number,
  tilt: number,
  ghost: boolean,
  pieceWire: boolean,
): void {
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, cw, ch);
  const P = makeProjector(s.W, s.D, s.H, cw, ch, { tilt });

  drawWireframe(ctx, P, s.W, s.D, s.H);

  const items: CubeItem[] = [];
  for (let z = 0; z < s.H; z++)
    for (let y = 0; y < s.D; y++)
      for (let x = 0; x < s.W; x++) {
        const v = s.cells[z * (s.W * s.D) + y * s.W + x] ?? 0;
        if (v !== 0) items.push({ x, y, z, v, bright: false });
      }
  if (s.piece_kind >= 0 && s.outcome === "in_progress") {
    for (const c of pieceCells(s.piece_kind, s.orient)) {
      const z = s.piece_z + c.z;
      if (z < 0) continue;
      items.push({
        x: s.piece_x + c.x,
        y: s.piece_y + c.y,
        z,
        v: s.piece_kind + 1,
        bright: true,
      });
    }
  }
  items.sort((a, b) => b.z - a.z); // far first

  for (const it of items) {
    const t = s.H > 1 ? it.z / (s.H - 1) : 0;
    // Falling piece in "ghost" style: a bright colored wireframe (no fill), so
    // the cube edges read cleanly rather than through translucent faces.
    if (it.bright && pieceWire) {
      ctx.globalAlpha = 1;
      drawCube(ctx, P, it.x, it.y, it.z, {
        front: "",
        side: "",
        stroke: cellColor(it.v, lerp(82, 60, t)),
        strokeWidth: PIECE_WIRE_WIDTH,
        wireframe: true,
      });
      continue;
    }
    const baseLight = it.bright ? lerp(88, 54, t) : lerp(70, 30, t);
    ctx.globalAlpha = it.bright ? PIECE_ALPHA : 1;
    drawCube(ctx, P, it.x, it.y, it.z, {
      front: cellColor(it.v, baseLight),
      side: cellColor(it.v, baseLight - 18),
      stroke: "rgba(4,6,10,0.55)",
    });
  }
  ctx.globalAlpha = 1;

  // Landing ghost — where a hard drop puts the piece, as a white wireframe.
  if (ghost && s.piece_kind >= 0 && s.outcome === "in_progress") {
    let gz = s.piece_z;
    while (!collides(s, s.piece_kind, s.orient, s.piece_x, s.piece_y, gz + 1))
      gz++;
    if (gz !== s.piece_z) {
      const cells = [...pieceCells(s.piece_kind, s.orient)].sort(
        (a, b) => b.z - a.z,
      );
      for (const c of cells) {
        const z = gz + c.z;
        if (z < 0) continue;
        drawCube(ctx, P, s.piece_x + c.x, s.piece_y + c.y, z, {
          front: "",
          side: "",
          stroke: "rgba(240,245,255,0.85)",
          strokeOnly: true,
        });
      }
    }
  }
}

export function makePitView(
  slot: HTMLElement,
  _config: BlockoideConfig,
): CenterView {
  const canvas = document.createElement("canvas");
  canvas.className = "blk-pit";
  canvas.setAttribute("aria-label", "blockoide pit");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(CANVAS_PX * dpr);
  canvas.height = Math.round(CANVAS_PX * dpr);
  canvas.style.width = `${CANVAS_PX}px`;
  canvas.style.height = `${CANVAS_PX}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("could not acquire 2d context on the blockoide pit");
  slot.appendChild(canvas);

  // `piece` defaults to "ghost" — the wireframe falling piece is the thing
  // under test; flip to "solid" for the translucent-cube look.
  const lens_state: Record<string, string> = {
    tilt: "angled",
    ghost: "false",
    piece: "ghost",
  };
  const tunableListeners = new Set<() => void>();
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    return lens_state[path[0] ?? ""];
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if (key === "tilt" && typeof value === "string" && value in TILTS) {
      lens_state.tilt = value;
      for (const cb of tunableListeners) cb();
    } else if (key === "ghost" && (value === "true" || value === "false")) {
      lens_state.ghost = value;
      for (const cb of tunableListeners) cb();
    } else if (key === "piece" && (value === "solid" || value === "ghost")) {
      lens_state.piece = value;
      for (const cb of tunableListeners) cb();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  function renderFrom(state: SubstrateState): void {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(
      ctx!,
      state,
      CANVAS_PX,
      CANVAS_PX,
      TILTS[lens_state.tilt ?? "angled"] ?? 0.08,
      lens_state.ghost !== "false",
      lens_state.piece === "ghost",
    );
  }

  return {
    renderFrom,
    unmount: () => {
      if (canvas.parentNode === slot) slot.removeChild(canvas);
    },
    tunables: PIT_TUNABLES,
    getTunable,
    setTunable,
    subscribeTunables,
    snapshot: () => canvas,
  };
}
