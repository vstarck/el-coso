/* Chrome layout constants + viewport-inset derivation.
 *
 * Single source of truth for the panel sizes used by `App.tsx`, the
 * `SubstrateHost` viewport-inset publisher, and any future chrome that
 * wants to reason about how much of the full-bleed canvas is currently
 * occluded by panels.
 *
 * The inset is the iOS-style "safe area" — number of pixels at each
 * edge that a SAFE_AREA-declaring lens should leave clear for its own
 * in-canvas HUD. PAD is included in every inset so HUD content gets
 * standard breathing room even when no panel is on that edge.
 */

import type { PanelsState } from "./store";

export const PAD = 16; // outer padding (spec §6)
export const GAP = 12; // inter-panel gap (spec §6)
export const TOOLBAR_H = 44; // spec §8
export const TIMELINE_H = 312;
export const INSPECTOR_W = 280;
export const RULES_W = 296;

export type ViewportInset = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function computeVisibleInset(panels: PanelsState): ViewportInset {
  return {
    top: PAD + (panels.toolbar ? TOOLBAR_H + GAP : 0),
    bottom: PAD + (panels.timeline ? TIMELINE_H + GAP : 0),
    left: PAD + (panels.inspector ? INSPECTOR_W + GAP : 0),
    right: PAD + (panels.rules ? RULES_W + GAP : 0),
  };
}

export function insetsEqual(a: ViewportInset, b: ViewportInset): boolean {
  return (
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.left === b.left
  );
}
