/* Scene transitions — the cutscene seam. A `SceneTransition` is a
 * runtime-tier effect played
 * over the OUTGOING scene's last frame while the stack pushes/pops. It is
 * NOT a Lens and NOT a lens lifecycle slot: the only lens surface it
 * consumes is the existing `snapshot()`, captured by the host before
 * unmount.
 *
 * Contract invariants:
 *  - Substrate-ignorant — never reads/writes substrate state.
 *  - Awaited, not raced — the host does not mount the incoming lens until
 *    the returned promise resolves; `"none"` resolves on the next microtask.
 *  - Best-effort, never load-bearing — a throw/reject must degrade to an
 *    instant cut (the host wraps the call in try/catch).
 */

export type SceneTransition = (
  from: HTMLCanvasElement | null, // outgoing scene's last frame, or null
  direction: "enter" | "exit",
  container: HTMLElement,
) => Promise<void>;

// Toggle off — an instant cut. Resolves next microtask so the no-op path
// adds no perceptible delay.
const none: SceneTransition = () => Promise.resolve();

// Fade through black. Two halves around the host's mount, both owned here:
//   1. the `from` frame fades out to black (the gate the host awaits);
//   2. once mount has happened beneath the still-opaque black layer, the
//      black fades out, revealing the incoming scene.
// Phase 2 is fire-and-forget after `resolve()`, so the host mounts under
// cover and the new scene fades in for free. `direction` is unused by the
// default (symmetric) fade but is part of the contract for richer ones.
const FADE_OUT_MS = 150;
const FADE_IN_MS = 150;

const fade: SceneTransition = (from, _direction, container) =>
  new Promise<void>((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.zIndex = "80";
    overlay.style.background = "#000";
    overlay.style.pointerEvents = "none";
    overlay.style.overflow = "hidden";

    // Show the outgoing frame on top of the black so phase 1 reads as a
    // dim rather than a 1-frame blank flash. Drawn centered, scaled to fit.
    let fromLayer: HTMLCanvasElement | null = null;
    if (from && from.width > 0 && from.height > 0) {
      const copy = document.createElement("canvas");
      copy.width = from.width;
      copy.height = from.height;
      const cctx = copy.getContext("2d");
      if (cctx) {
        cctx.drawImage(from, 0, 0);
        copy.style.position = "absolute";
        copy.style.inset = "0";
        copy.style.margin = "auto";
        copy.style.maxWidth = "100%";
        copy.style.maxHeight = "100%";
        copy.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`;
        copy.style.opacity = "1";
        overlay.appendChild(copy);
        fromLayer = copy;
      }
    }
    container.appendChild(overlay);

    // Phase 1: fade the `from` frame out, revealing black.
    requestAnimationFrame(() => {
      if (fromLayer) fromLayer.style.opacity = "0";
    });

    window.setTimeout(() => {
      // Black is now fully covering. Let the host mount underneath.
      resolve();
      // Phase 2: fade the black away, revealing the freshly mounted scene.
      requestAnimationFrame(() => {
        overlay.style.transition = `opacity ${FADE_IN_MS}ms ease-out`;
        overlay.style.opacity = "0";
        window.setTimeout(() => overlay.remove(), FADE_IN_MS + 40);
      });
    }, FADE_OUT_MS + 20);
  });

export const SCENE_TRANSITIONS: Record<string, SceneTransition> = {
  none,
  fade,
};

// The active transition is a view-tier setting. One
// module-level choice for now; a future settings surface can flip it.
let active_name = "fade";

export function setActiveTransition(name: string): void {
  if (SCENE_TRANSITIONS[name]) active_name = name;
}

export function getActiveTransition(): SceneTransition {
  return SCENE_TRANSITIONS[active_name] ?? none;
}
