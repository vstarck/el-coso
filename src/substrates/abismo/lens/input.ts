/* Scroll → depth input. Wheel deltas accumulate into a signed depth change that
 * the lens drains once per tick and feeds to the engine as `scrollDelta` (so it
 * rides the recorded input stream and replays exactly). Down/forward = deeper
 * (+), up/back = shallower (−). The first real wheel event fires `onIntent` so
 * the lens hands control from the auto-dive to the reader (the tts/blockoide
 * hand-off pattern). Sensitivity is depth units per pixel of wheel travel,
 * settable from the `scroll_sensitivity` tunable.
 */

export type ScrollInput = {
  // Accumulated signed depth delta since the last call; resets to 0.
  drain(): number;
  setSensitivity(depthPerPx: number): void;
  detach(): void;
};

export const DEFAULT_SCROLL_SENSITIVITY = 0.0012; // depth per px (dev-viewer feel)
export const MIN_SCROLL_SENSITIVITY = 0.0002;
export const MAX_SCROLL_SENSITIVITY = 0.01;

export function attachScroll(target: HTMLElement, onIntent: () => void): ScrollInput {
  let accum = 0;
  let sensitivity = DEFAULT_SCROLL_SENSITIVITY;

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    accum += e.deltaY * sensitivity;
    onIntent();
  }
  target.addEventListener("wheel", onWheel, { passive: false });

  return {
    drain(): number {
      const d = accum;
      accum = 0;
      return d;
    },
    setSensitivity(depthPerPx: number): void {
      sensitivity = Math.max(
        MIN_SCROLL_SENSITIVITY,
        Math.min(MAX_SCROLL_SENSITIVITY, depthPerPx),
      );
    },
    detach(): void {
      target.removeEventListener("wheel", onWheel);
    },
  };
}
