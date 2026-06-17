/* Brush input kit — converts a pointer-held-and-moved gesture
 * into a stream of discrete cell stamps. Sibling of `attachPanDrag`: the
 * two kits each own their own pointer state machine and are disjoint by
 * button mapping (brush takes plain left, pan takes shift+left and
 * middle).
 *
 * Decimation is spatial-then-temporal: emit when the cursor has crossed
 * ≥ `spacingCells` cells (Euclidean in cell space) AND ≥ `spacingMs`
 * milliseconds have elapsed since the last emission. The initial stamp
 * on mousedown bypasses both checks, so a click-and-release with no
 * pointermove between still emits exactly one stamp — the click-equals-
 * one-stamp regression invariant.
 *
 * The lens supplies a `projectCell` callback that maps a viewport pointer
 * position to either an `on_patch` cell or an `off_patch` sentinel; the
 * kit consumes that result and never knows which lens it serves. Off-
 * patch positions neither emit nor count against the spatial threshold
 * (the threshold compares against the last *emitted* stamp's cell, not
 * the cursor path).
 *
 * Stroke end is mouseup-only. A pointer that briefly exits the canvas
 * during a fast drag still strokes (mousemove is bound to window); the
 * stroke ends on the next mouseup regardless of where the cursor is.
 */

export type BrushCellProjector = (
  client_x: number,
  client_y: number,
) =>
  | { kind: "on_patch"; cell_x: number; cell_y: number }
  | { kind: "off_patch" };

export type BrushStamp = {
  cell_x: number;
  cell_y: number;
  client_x: number;
  client_y: number;
};

export type BrushOpts = {
  canvas: HTMLCanvasElement;
  /** Lens-supplied cursor → cell projector. */
  projectCell: BrushCellProjector;
  /** Called once per emitted stamp (after decimation). */
  onStamp: (stamp: BrushStamp) => void;
  /** Spatial threshold — emit at most once per K cells of cursor motion
   *  (Euclidean in cell space). Default 1.0. */
  spacingCells?: number;
  /** Temporal floor — emit at most once per M milliseconds. Default 16
   *  (~60 Hz cap). Combines with spacingCells: both conditions must be
   *  met for a non-initial stamp to fire. */
  spacingMs?: number;
  /** Predicate returning true when the event should NOT begin a stroke
   *  (because another gesture owns the pointer — pan, etc.).
   *  Default: `(e) => e.button !== 0 || e.shiftKey`. */
  suppress?: (e: MouseEvent) => boolean;
};

export type BrushHandle = {
  detach: () => void;
  /** True between mousedown of a non-suppressed gesture and the
   *  matching mouseup. */
  isStroking: () => boolean;
};

function defaultSuppress(e: MouseEvent): boolean {
  return e.button !== 0 || e.shiftKey;
}

export function attachBrush(opts: BrushOpts): BrushHandle {
  const { canvas, projectCell, onStamp } = opts;
  const spacing_cells = opts.spacingCells ?? 1.0;
  const spacing_ms = opts.spacingMs ?? 16;
  const suppress = opts.suppress ?? defaultSuppress;

  let stroking = false;
  let last_stamp_cell: { x: number; y: number } | null = null;
  // 0 at stroke start so the first move can never get gated by the
  // temporal floor on its own (the initial-stamp path bypasses spacing
  // entirely; this default just guarantees correctness if a subclass
  // ever flips the initial flag).
  let last_stamp_time = 0;

  function emitIfEligible(
    client_x: number,
    client_y: number,
    is_initial: boolean,
  ): void {
    const hit = projectCell(client_x, client_y);
    if (hit.kind === "off_patch") return;
    if (!is_initial) {
      if (last_stamp_cell !== null) {
        const dx = hit.cell_x - last_stamp_cell.x;
        const dy = hit.cell_y - last_stamp_cell.y;
        if (Math.hypot(dx, dy) < spacing_cells) return;
      }
      if (performance.now() - last_stamp_time < spacing_ms) return;
    }
    onStamp({
      cell_x: hit.cell_x,
      cell_y: hit.cell_y,
      client_x,
      client_y,
    });
    last_stamp_cell = { x: hit.cell_x, y: hit.cell_y };
    last_stamp_time = performance.now();
  }

  function onMouseDown(e: MouseEvent): void {
    if (suppress(e)) return;
    stroking = true;
    last_stamp_cell = null;
    last_stamp_time = 0;
    emitIfEligible(e.clientX, e.clientY, true);
  }
  function onMouseMove(e: MouseEvent): void {
    if (!stroking) return;
    emitIfEligible(e.clientX, e.clientY, false);
  }
  function onMouseUp(): void {
    if (!stroking) return;
    stroking = false;
  }

  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  return {
    detach: () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    },
    isStroking: () => stroking,
  };
}
