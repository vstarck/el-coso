/* Canvas backing-buffer sync — match the canvas's pixel dimensions to its
 * CSS box, and re-sync on window resize. Extracted from the canvas lenses, which all shipped the same syncCanvasSize body.
 *
 * The post-resize hook varies per lens (re-center pan, re-render, or
 * neither), so it's passed in: the helper gives the caller `(canvas,
 * prev)` after each successful resize so they can decide what to do.
 */

export type CanvasPrevSize = { w: number; h: number };

export type AttachCanvasSizingOpts = {
  /** Called after each window resize, post-sync. `prev` is the previous
   * backing-buffer size; the caller can diff against current canvas.width
   * / canvas.height to re-center pan, re-render, etc. */
  onResize?: (canvas: HTMLCanvasElement, prev: CanvasPrevSize) => void;
};

export type CanvasSizingHandle = {
  /** Re-sync the backing buffer to the current CSS box. Idempotent. */
  sync: () => void;
  /** Remove the window resize listener. */
  detach: () => void;
};

export function attachCanvasSizing(
  canvas: HTMLCanvasElement,
  opts: AttachCanvasSizingOpts = {},
): CanvasSizingHandle {
  function sync(): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  sync();

  function onResize(): void {
    const prev: CanvasPrevSize = { w: canvas.width, h: canvas.height };
    sync();
    opts.onResize?.(canvas, prev);
  }
  window.addEventListener("resize", onResize);

  return {
    sync,
    detach: () => {
      window.removeEventListener("resize", onResize);
    },
  };
}
