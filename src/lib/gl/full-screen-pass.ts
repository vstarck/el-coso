/* Full-screen shader pass — render a fragment shader across the entire
 * viewport with a clip-space-aligned quad. No projection needed; the
 * vertex shader passes `a_corner` straight through to `gl_Position`.
 *
 * Used for: field rendering (one fragment shader samples all
 * field textures, composites color per pixel), post-process passes
 * (a fade-and-scrub pass), background clears with a
 * shader rather than a uniform color.
 *
 * Reserved per-vertex attribute: `a_corner` (vec2). The consumer's
 * vertex shader MUST declare `in vec2 a_corner;` and output
 * `gl_Position = vec4(a_corner, 0.0, 1.0)`. To recover UV coordinates
 * `[0, 1]² in the fragment shader, the typical vertex stage writes
 * `v_uv = a_corner * 0.5 + 0.5`.
 *
 * Doesn't clear — the caller decides composition. `gl.clear(
 * gl.COLOR_BUFFER_BIT)` before `draw()` for a clean background.
 */

import type { Shader } from "./shader";

export type FullScreenPass = {
  /** Caller must have called `shader.use()` and set uniforms first. */
  draw: () => void;
  destroy: () => void;
};

// Two triangles spanning clip space [-1, 1]² — every pixel in the
// viewport gets a fragment shader invocation.
const CLIP_QUAD = new Float32Array([
  -1, -1,
   1, -1,
   1,  1,
  -1, -1,
   1,  1,
  -1,  1,
]);

export function createFullScreenPass(
  gl: WebGL2RenderingContext,
  shader: Shader,
): FullScreenPass {
  const vao = gl.createVertexArray();
  if (vao === null) throw new Error("gl.createVertexArray returned null");
  gl.bindVertexArray(vao);

  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error("gl.createBuffer returned null");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, CLIP_QUAD, gl.STATIC_DRAW);

  const corner_loc = shader.getAttribLocation("a_corner");
  if (corner_loc < 0) {
    throw new Error(
      "createFullScreenPass: shader has no `in vec2 a_corner;` attribute. The pass binds clip-space corners to it.",
    );
  }
  gl.enableVertexAttribArray(corner_loc);
  gl.vertexAttribPointer(corner_loc, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    draw: () => {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },
    destroy: () => {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
  };
}
