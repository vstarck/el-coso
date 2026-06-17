/* Shaft center-view — the 3D pit done entirely in ASCII. Each depth slice
 * (the cross-section at one z) is its own <pre>; the slices are stacked and
 * CSS-scaled by depth so the stack *is* the perspective tunnel — no
 * projection math. Near slices are larger and sit on top (higher z-index);
 * filled cells are opaque and occlude the deeper slices behind them, empty
 * cells are transparent so the depth shows through. Each slice's border
 * draws one tunnel ring.
 *
 * Extracted from the former `blockoide-shaft` lens. The view only
 * renders; input + the tick loop now live in the deck's controller.
 */

import { renderToPre } from "@/lib/ascii";
import type { LensTunable, TunableValue } from "@/lenses/types";
import type { BlockoideConfig, SubstrateState } from "../../engine";
import {
  buildSliceSurface,
  SHAFT_THEMES,
  DEFAULT_SHAFT_THEME,
  type ShaftTheme,
} from "../render";
import type { CenterView } from "./types";

// Characters per game cell (a small block, so a slice is legible). Columns
// follow the ~0.6 monospace aspect so cells read square.
const SS_Y = 4;
const SS_X = 7;
const FONT_PX = 17;
const CHAR_W = FONT_PX * 0.6;
// Default look-into amount — the deepest slice lifts this fraction of its own
// (perspective-scaled) height. 0 = concentric (no tilt). Dial-able per lens.
const DEFAULT_TILT = 0.0;

// How much the far slices shrink relative to the near one. The value is a
// camera-distance factor (× well depth): smaller = closer camera = stronger
// perspective = bigger near↔far size difference.
const PERSPECTIVE: Record<string, number> = {
  subtle: 0.7,
  normal: 0.45,
  strong: 0.3,
  deep: 0.2,
};
const PERSPECTIVE_KEYS = Object.keys(PERSPECTIVE);

export const SHAFT_TUNABLES: LensTunable[] = [
  {
    id: "perspective",
    group: "Lens",
    label: "Perspective",
    type: "enum",
    options: PERSPECTIVE_KEYS,
    target: "lens",
    path: ["perspective"],
  },
  {
    id: "tilt",
    group: "Lens",
    label: "Look-into",
    type: "float",
    min: 0,
    max: 1,
    step: 0.05,
    target: "lens",
    path: ["tilt"],
  },
  {
    id: "theme",
    group: "Lens",
    label: "Theme",
    type: "enum",
    options: Object.keys(SHAFT_THEMES),
    target: "lens",
    path: ["theme"],
  },
];

// Perspective scale of the slice at depth z (z=0 nearest = 1).
function sliceScale(z: number, H: number, factor: number): number {
  const camDist = Math.max(2, H * factor);
  return camDist / (camDist + z);
}

export function makeShaftView(
  slot: HTMLElement,
  config: BlockoideConfig,
): CenterView {
  const { W, D, H } = config;

  // The shaft: a relatively-positioned box the slices center inside. Sized
  // to the near (largest) slice plus tilt headroom.
  const shaft = document.createElement("div");
  shaft.className = "blk-shaft";
  const nearW = W * SS_X * CHAR_W;
  const nearH = D * SS_Y * FONT_PX;
  shaft.style.width = `${Math.ceil(nearW)}px`;
  // Height is set in applyLayout — it grows with the tilt headroom.
  slot.appendChild(shaft);

  const slices: HTMLPreElement[] = [];
  for (let z = 0; z < H; z++) {
    const pre = document.createElement("pre");
    pre.className = "blk-slice";
    pre.style.fontSize = `${FONT_PX}px`;
    pre.style.left = "50%";
    pre.style.zIndex = String(H - z); // near slices on top
    shaft.appendChild(pre);
    slices.push(pre);
  }
  // Tunnel-ring colors come from the active theme (set in colorBorders below).

  // --- Tunables ----------------------------------------------------------
  const lens_state: Record<string, string> = {
    theme: DEFAULT_SHAFT_THEME,
    perspective: "normal",
  };
  let tilt = DEFAULT_TILT;

  function theme(): ShaftTheme {
    return SHAFT_THEMES[lens_state.theme ?? ""] ?? SHAFT_THEMES.classic!;
  }

  // Paint each slice's tunnel ring from the active theme — bright `accent` on
  // the opening + floor edges, faint `ring` on the interior slices.
  function colorBorders(): void {
    const th = theme();
    for (let z = 0; z < H; z++) {
      const edge = z === 0 || z === H - 1;
      slices[z]!.style.borderColor = edge ? th.accent : th.ring;
    }
  }
  colorBorders();

  // Position + scale every slice. Re-run when `perspective` / `tilt` change
  // (only the transform + container height move; the <pre> content is the
  // per-frame job).
  function applyLayout(): void {
    const factor =
      PERSPECTIVE[lens_state.perspective ?? "normal"] ?? PERSPECTIVE.normal!;
    const sFar = sliceScale(H - 1, H, factor);
    // The deepest slice lifts ±maxLift/2 about center (near slices nudge down,
    // far slices up), so the stack stays vertically centered. maxLift scales
    // with the far slice's size, so the look-into is a constant fraction of
    // that slice at any perspective — no over-shoot at "deep".
    const maxLift = tilt * sFar * nearH;
    shaft.style.height = `${Math.ceil(nearH + maxLift)}px`;
    for (let z = 0; z < H; z++) {
      const s = sliceScale(z, H, factor);
      const t = H > 1 ? z / (H - 1) : 0;
      const off = maxLift * (0.5 - t); // +near (down) … −far (up)
      slices[z]!.style.top = `calc(50% + ${off.toFixed(1)}px)`;
      slices[z]!.style.transform =
        `translate(-50%, -50%) scale(${s.toFixed(4)})`;
    }
  }
  applyLayout();

  const tunableListeners = new Set<() => void>();
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    if (path[0] === "tilt") return tilt;
    return lens_state[path[0] ?? ""];
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if (
      key === "theme" &&
      typeof value === "string" &&
      value in SHAFT_THEMES
    ) {
      lens_state.theme = value;
      colorBorders();
      for (const cb of tunableListeners) cb();
    } else if (
      key === "perspective" &&
      typeof value === "string" &&
      value in PERSPECTIVE
    ) {
      // (The former lens dropped this branch, so perspective was a dead
      // tunable — fixed on extraction.)
      lens_state.perspective = value;
      applyLayout();
      for (const cb of tunableListeners) cb();
    } else if (key === "tilt" && typeof value === "number") {
      tilt = Math.max(0, Math.min(1, value));
      applyLayout();
      for (const cb of tunableListeners) cb();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  function renderFrom(state: SubstrateState): void {
    const th = theme();
    for (let z = 0; z < H; z++) {
      renderToPre(buildSliceSurface(state, z, th, SS_X, SS_Y), slices[z]!);
    }
  }

  return {
    renderFrom,
    unmount: () => {
      if (shaft.parentNode === slot) slot.removeChild(shaft);
    },
    tunables: SHAFT_TUNABLES,
    getTunable,
    setTunable,
    subscribeTunables,
  };
}
