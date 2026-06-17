/* mountLensTree — recursively mount a lens + its declared `layers` into
 * plain DOM. Host-agnostic: no React, no store. Both the React app's
 * SubstrateHost and the store-free `mountHost` drive their lens trees
 * through this one function (extracted from SubstrateHost when the
 * react-less host needed the same recursion).
 *
 * The host provides TWO frames per top-level call:
 * - `outer`      — where child lenses mount as siblings (full viewport).
 * - `root_frame` — where this lens itself mounts (feature-styled by the
 *                  caller: BOUNDED centering, perspective tilt, etc.).
 * For recursion (child lenses), `outer` and `root_frame` are the same
 * element — children are always full-bleed; no nested feature wrapping.
 */

import type {
  Lens,
  LensHost,
  MountedLens,
  RenderSize,
  ViewportInset,
} from "@/lenses/types";
import type { History, TickedState } from "@/history";

export type LensTree<State extends TickedState> = {
  root: MountedLens<State>;
  // All mounts in tree order (root first). The host's rAF calls renderFrom
  // on each in this order; the browser composites the resulting DOM
  // canvases via z-index, so paint order doesn't affect visual stacking —
  // but a stable order makes debugging easier.
  all: MountedLens<State>[];
  unmount: () => void;
};

export function mountLensTree<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  lens: Lens<State, Config, Input, CommitPayload>,
  outer: HTMLElement,
  root_frame: HTMLElement,
  history: History<State, Config, Input, CommitPayload>,
  host: LensHost,
  subscribeViewport: (cb: (inset: ViewportInset) => void) => () => void,
  renderSize: RenderSize | undefined,
  z_base: number,
): LensTree<State> {
  // Mount children first so the root can receive their handles. Each child
  // gets a sibling absolute-inset:0 frame inside `outer` (the host-provided
  // full-viewport surface), z-indexed by array order above the root.
  const child_trees: LensTree<State>[] = [];
  const child_frames: HTMLElement[] = [];
  const child_layers = lens.layers ?? [];
  for (let i = 0; i < child_layers.length; i++) {
    const child_lens = child_layers[i]!;
    const child_frame = document.createElement("div");
    child_frame.style.position = "absolute";
    child_frame.style.inset = "0";
    child_frame.style.zIndex = String(z_base + (i + 1) * 10);
    // Default to click-pass-through so the underlying lens stays
    // interactive. Interactive children override on their own elements.
    child_frame.style.pointerEvents = "none";
    outer.appendChild(child_frame);
    child_frames.push(child_frame);
    // For grandchildren: child_frame is both `outer` (where grandchildren
    // mount as siblings) and `root_frame` (where the child itself mounts).
    // Children are always full-bleed; no feature-aware wrapping at sub-root
    // levels (yet).
    child_trees.push(
      mountLensTree(
        child_lens,
        child_frame,
        child_frame,
        history,
        host,
        subscribeViewport,
        renderSize,
        z_base + (i + 1) * 10,
      ),
    );
  }

  // Mount this lens directly into the host-provided `root_frame`. For the
  // top-level call, the caller already styled `root_frame` per the lens's
  // features (BOUNDED centering, perspective tilt, flat). For recursion,
  // `root_frame === outer` (full-bleed child placement).
  const root_mount = lens.mount({
    container: root_frame,
    history,
    host,
    subscribeViewport,
    renderSize,
    children: child_trees.map((t) => t.root),
  });

  const all: MountedLens<State>[] = [root_mount];
  for (const t of child_trees) all.push(...t.all);

  return {
    root: root_mount,
    all,
    unmount: () => {
      // Reverse-mount cleanup: children first (deepest leaves via each
      // child_tree's own recursive unmount), then this lens's root, then
      // the child frames themselves.
      for (let i = child_trees.length - 1; i >= 0; i--) {
        child_trees[i]!.unmount();
      }
      root_mount.unmount();
      for (let i = child_frames.length - 1; i >= 0; i--) {
        const cf = child_frames[i]!;
        if (cf.parentNode === outer) outer.removeChild(cf);
      }
    },
  };
}
