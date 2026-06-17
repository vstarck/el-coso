/* 2D orthographic camera with pan + zoom. Owns the world → clip
 * projection matrix the vertex shader uses, plus the inverse
 * (canvas-pixel → world unit) for click handling.
 *
 * Pan is in **canvas pixels** (matches the project's existing pan-drag
 * convention — attachPanDrag mutates pan.x/y by mouse `movementX/Y`,
 * which is CSS-pixel-space). Zoom is **pixels per world unit** (cell
 * size — e.g. 12 px/cell for a typical field).
 * The lens passes `camera.pan` directly to `attachPanDrag`.
 *
 * Coordinate convention: world has +Y down (matching the substrate's
 * row-major `idx = y * W + x` convention). The matrix flips Y so clip
 * space's +Y up displays world's row 0 at the top of the canvas.
 *
 * Matrix is column-major (the WebGL convention); pass directly to
 * `gl.uniformMatrix4fv(loc, false, matrix)`.
 *
 * Pan and zoom are public mutable fields — assign directly. The next
 * `projectionMatrix()` call picks up the new values.
 */

export type Camera = {
  /** Pan offset in canvas pixels. World point `(pan.x / zoom, pan.y /
   * zoom)` sits at the canvas top-left corner. Mutated directly by
   * `attachPanDrag`. */
  pan: { x: number; y: number };
  /** Pixels per world unit. Higher = zoomed in. */
  zoom: number;
  setViewport: (width_px: number, height_px: number) => void;
  projectionMatrix: () => Float32Array;
  /** Canvas-pixel coordinates (e.clientX - rect.left, e.clientY -
   * rect.top) → world units. */
  unprojectClick: (canvas_x: number, canvas_y: number) => { x: number; y: number };
};

export function createCamera(): Camera {
  let viewport_w = 1;
  let viewport_h = 1;
  const matrix = new Float32Array(16);

  const camera: Camera = {
    pan: { x: 0, y: 0 },
    zoom: 1,
    setViewport: (w_px, h_px) => {
      viewport_w = Math.max(1, w_px);
      viewport_h = Math.max(1, h_px);
    },
    projectionMatrix: () => {
      const sx = 2 * camera.zoom / viewport_w;
      const sy = -2 * camera.zoom / viewport_h;  // Y-flip for world-down → clip-up.
      const tx = -2 * camera.pan.x / viewport_w - 1;
      const ty = 2 * camera.pan.y / viewport_h + 1;
      // Column-major.
      matrix[0]  = sx;  matrix[1]  = 0;   matrix[2]  = 0; matrix[3]  = 0;
      matrix[4]  = 0;   matrix[5]  = sy;  matrix[6]  = 0; matrix[7]  = 0;
      matrix[8]  = 0;   matrix[9]  = 0;   matrix[10] = 1; matrix[11] = 0;
      matrix[12] = tx;  matrix[13] = ty;  matrix[14] = 0; matrix[15] = 1;
      return matrix;
    },
    unprojectClick: (canvas_x, canvas_y) => ({
      x: (canvas_x + camera.pan.x) / camera.zoom,
      y: (canvas_y + camera.pan.y) / camera.zoom,
    }),
  };
  return camera;
}
