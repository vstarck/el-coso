/* Pan-drag — middle-mouse or shift+left to drag a 2D `pan` offset.
 * Extracted from the canvas lenses, which all shipped
 * the same isPanGesture / mousedown / window-mousemove / window-mouseup /
 * auxclick wiring.
 *
 * Lenses without an rAF loop pass `onPan` to re-render after
 * each delta; rAF-driven lenses leave it undefined and let the next frame
 * pick up the new pan.
 *
 * Click-suppression: every gesture accumulates |dx|+|dy| into a counter
 * the caller can read in its own click handler — `dragDistance() > N`
 * means "this was a real drag, swallow the trailing click."
 */

export type PanDragOpts = {
  /** Mutable pan offset. The helper updates `.x` and `.y` in place. */
  pan: { x: number; y: number };
  /** Called after each pan delta is applied. Use for lenses that don't
   * have an rAF loop ticking renderFrom every frame. */
  onPan?: () => void;
  /** Cursor while a pan-drag gesture is active. Default `"grabbing"`. */
  dragCursor?: string;
  /** Cursor restored on mouseup. Default `""` (clears inline cursor,
   * falling back to whatever the stylesheet sets). Lenses with their own
   * default cursor (e.g. `"pointer"` for click-to-act) pass that value
   * so the helper restores it correctly after a drag. */
  idleCursor?: string;
};

export type PanDragHandle = {
  /** Remove all listeners; restore nothing. */
  detach: () => void;
  /** Sum of |dx|+|dy| over the most recent gesture, resets on mousedown.
   * Read in your click handler to suppress accidental clicks at the end
   * of a drag (`if (dragDistance() > 4) return`). */
  dragDistance: () => number;
  /** True between mousedown and mouseup of an active pan gesture. Read
   * by hover / preview handlers that should suppress while panning. */
  isDragging: () => boolean;
};

function isPanGesture(e: MouseEvent): boolean {
  return e.button === 1 || (e.button === 0 && e.shiftKey);
}

export function attachPanDrag(
  canvas: HTMLCanvasElement,
  opts: PanDragOpts,
): PanDragHandle {
  const { pan, onPan } = opts;
  const dragCursor = opts.dragCursor ?? "grabbing";
  const idleCursor = opts.idleCursor ?? "";

  let dragging = false;
  let drag_distance = 0;
  let last_x = 0;
  let last_y = 0;

  function onMouseDown(e: MouseEvent): void {
    if (!isPanGesture(e)) return;
    e.preventDefault();
    dragging = true;
    drag_distance = 0;
    last_x = e.clientX;
    last_y = e.clientY;
    canvas.style.cursor = dragCursor;
  }
  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    const dx = e.clientX - last_x;
    const dy = e.clientY - last_y;
    pan.x -= dx;
    pan.y -= dy;
    drag_distance += Math.abs(dx) + Math.abs(dy);
    last_x = e.clientX;
    last_y = e.clientY;
    onPan?.();
  }
  function onMouseUp(): void {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = idleCursor;
  }
  function onAuxClick(e: MouseEvent): void {
    // Suppress browser middle-click autoscroll on the canvas.
    if (e.button === 1) e.preventDefault();
  }

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("auxclick", onAuxClick);

  return {
    detach: () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("auxclick", onAuxClick);
    },
    dragDistance: () => drag_distance,
    isDragging: () => dragging,
  };
}
