/* Blockoide playground lens — a static render bench, not a game.
 *
 * Like the manual lens, it ignores the live substrate and draws a fixed scene:
 * the empty 5×5×12 well grid with a single cube at (3, 3, 0), rendered by
 * exercising the `@/lib/canvas/3d` kit directly (projector + `drawCube`). The
 * cube carries a per-facet `faces` palette so the bench shows off — and is a
 * place to iterate on — the cube renderer in isolation. The well grid is the
 * pit view's `drawWireframe`, reused as-is.
 *
 * Tunables: `tilt` (look-into), `mode` (solid / wireframe), and `opacity`
 * (0–1). Below full opacity the cube stops culling so its back facets show
 * through the glass. It does not tick: the host's render-only rAF loop redraws
 * the bench each frame, so tunable edits reflect immediately.
 */

import type {
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
} from "@/lenses/types";
import {
  drawCubes,
  makeProjector,
  type CubeFace,
  type CubeInstance,
  type CubeStyle,
} from "@/lib/canvas/3d";
import type {
  BlockoideCommitPayload,
  BlockoideConfig,
  BlockoideInputs,
  SubstrateState,
} from "../engine";
import { CADENCE, SPEEDS } from "./controller";
import { CANVAS_PX, TILTS, drawWireframe } from "./view/pit";

const ACCENT = "#41bf00";
const W = 5;
const D = 5;
const H = 12;

// One distinct color per facet — exercises the per-face `CubeStyle`. For this
// camera the cube (right-of-center, below-center) shows nearZ / negX / negY:
// red front, yellow left, cyan top.
const FACE_COLORS: Partial<Record<CubeFace, string>> = {
  nearZ: "#e23a3a", // front  — red
  farZ: "#3ad06a", // back   — green
  posX: "#3a7ae2", // right  — blue
  negX: "#e0c93a", // left   — yellow
  posY: "#c93ad0", // bottom — magenta
  negY: "#3ad0d0", // top    — cyan
};
// Bright single-color outline for wireframe mode.
const WIRE_STROKE = "#dfe7f5";

type BenchCube = {
  x: number;
  y: number;
  z: number;
  front: string;
  side: string;
  faces?: Partial<Record<CubeFace, string>>;
};

// The bench scene: a lonely per-facet color-demo cube on the right, and a
// vertical 4-line I piece on the left — every cube painted with the SAME
// per-facet palette, so any cross-cube rendering inconsistency stands out.
const PALETTE = { front: "#888", side: "#444", faces: FACE_COLORS } as const;
const BENCH_CUBES: BenchCube[] = [
  { x: 3, y: 3, z: 0, ...PALETTE },
  { x: 1, y: 1, z: 0, ...PALETTE },
  { x: 1, y: 2, z: 0, ...PALETTE },
  { x: 1, y: 3, z: 0, ...PALETTE },
  { x: 1, y: 4, z: 0, ...PALETTE },
];

const PLAYGROUND_TUNABLES: LensTunable[] = [
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
    id: "mode",
    group: "Lens",
    label: "Render",
    type: "enum",
    options: ["solid", "wireframe"],
    target: "lens",
    path: ["mode"],
  },
  {
    id: "opacity",
    group: "Lens",
    label: "Opacity",
    type: "float",
    min: 0,
    max: 1,
    step: 0.05,
    target: "lens",
    path: ["opacity"],
  },
];

function mountPlayground(
  args: LensMountArgs<
    SubstrateState,
    BlockoideConfig,
    BlockoideInputs,
    BlockoideCommitPayload
  >,
): MountedLens<SubstrateState> {
  const canvas = document.createElement("canvas");
  canvas.className = "blk-pit";
  canvas.setAttribute("aria-label", "blockoide playground");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(CANVAS_PX * dpr);
  canvas.height = Math.round(CANVAS_PX * dpr);
  canvas.style.width = `${CANVAS_PX}px`;
  canvas.style.height = `${CANVAS_PX}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on the playground");
  args.container.appendChild(canvas);

  let tilt = "angled";
  let mode = "solid";
  let opacity = 1;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  function render(): void {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.fillStyle = "#04060a";
    ctx!.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
    const P = makeProjector(W, D, H, CANVAS_PX, CANVAS_PX, {
      tilt: TILTS[tilt] ?? 0.08,
    });
    drawWireframe(ctx!, P, W, D, H);

    ctx!.globalAlpha = opacity;
    // One global, face-level back-to-front pass over every cube (drawCubes),
    // so neighbors occlude each other correctly instead of cube-by-cube.
    const cubes: CubeInstance[] = BENCH_CUBES.map((cu) => {
      let style: CubeStyle;
      if (mode === "wireframe") {
        style = {
          front: "",
          side: "",
          stroke: WIRE_STROKE,
          strokeWidth: 2,
          wireframe: true,
        };
      } else {
        // Opaque → cull (clean solid box); translucent → keep all facets so the
        // back ones show through the glass.
        style = {
          front: cu.front,
          side: cu.side,
          stroke: "rgba(4,6,10,0.55)",
          cull: opacity >= 1,
        };
        if (cu.faces) style.faces = cu.faces;
      }
      return { x: cu.x, y: cu.y, z: cu.z, style };
    });
    drawCubes(ctx!, P, cubes);
    ctx!.globalAlpha = 1;
  }

  return {
    unmount: () => {
      if (canvas.parentNode === args.container) {
        args.container.removeChild(canvas);
      }
    },
    renderFrom: render, // ignores the live state — always the bench
    commitGlyph: () => ({ kind: "circle" }),
    pause: () => {},
    resume: () => {},
    step: () => {},
    setSpeed: () => {},
    getTunable: (path) => {
      const k = path[0];
      if (k === "tilt") return tilt;
      if (k === "mode") return mode;
      if (k === "opacity") return opacity;
      return undefined;
    },
    setTunable: (path, value) => {
      const k = path[0];
      if (k === "tilt" && typeof value === "string" && value in TILTS) {
        tilt = value;
      } else if (
        k === "mode" &&
        (value === "solid" || value === "wireframe")
      ) {
        mode = value;
      } else if (k === "opacity" && typeof value === "number") {
        opacity = Math.max(0, Math.min(1, value));
      } else {
        return;
      }
      notify();
    },
    subscribeTunables: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot: () => canvas,
  };
}

export const blockoidePlaygroundLens: Lens<
  SubstrateState,
  BlockoideConfig,
  BlockoideInputs,
  BlockoideCommitPayload
> = {
  id: "blockoide-playground",
  name: "Pit Playground",
  tunables: PLAYGROUND_TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "canvas2d",
  features: ["BOUNDED"],
  theme: { accent: ACCENT },
  mount: mountPlayground,
};
