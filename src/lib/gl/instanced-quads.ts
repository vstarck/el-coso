/* Instanced quad rendering — draw N small quads in one draw call via
 * `gl.drawArraysInstanced`. The CPU does *one* draw call no matter
 * how many instances; the GPU runs the vertex shader once per
 * instance × per quad-corner, all in parallel.
 *
 * Used for: agent fields (thousands of instances), bias markers, and per-cell renders. Any
 * "many similar small things" case.
 *
 * Reserved per-vertex attribute: `a_corner` (vec2). The kit's geometry
 * buffer holds 6 vertices forming a `[-0.5, 0.5]` quad. The consumer's
 * vertex shader MUST declare `in vec2 a_corner;` and use it (typically
 * as an offset around the per-instance position).
 *
 * Per-instance attributes are declared via the `instance_attributes`
 * array; their names must match the consumer's vertex-shader `in`
 * declarations. Order in the array determines memory layout in the
 * data buffer (interleaved, tightly packed floats).
 *
 * `setInstanceData(data, count)` uploads with `DYNAMIC_DRAW` (driver
 * hint: this buffer is updated often). Reallocating to a new size is
 * automatic — the driver handles capacity changes efficiently.
 */

import type { Shader } from "./shader";

export type InstanceAttribute = {
  /** Must match the consumer's vertex-shader `in` declaration. */
  name: string;
  /** Number of floats per instance for this attribute (1, 2, 3, 4). */
  size: 1 | 2 | 3 | 4;
};

export type InstancedQuads = {
  /** Upload N instances' worth of attribute data. `data.length` must
   * equal `instance_count * sum(attribute sizes)`. */
  setInstanceData: (data: Float32Array, instance_count: number) => void;
  /** Issue one `drawArraysInstanced` for the currently-uploaded
   * instance buffer. Caller must have called `shader.use()` and set
   * uniforms beforehand. */
  draw: () => void;
  destroy: () => void;
};

// Two triangles forming a quad centered at origin, side length 1.
// Vertex order: top-left, bottom-left, bottom-right, top-left,
// bottom-right, top-right. Pointy-side culling is disabled by default;
// winding doesn't matter.
const QUAD_CORNERS = new Float32Array([
  -0.5, -0.5,
   0.5, -0.5,
   0.5,  0.5,
  -0.5, -0.5,
   0.5,  0.5,
  -0.5,  0.5,
]);

export function createInstancedQuads(
  gl: WebGL2RenderingContext,
  shader: Shader,
  instance_attributes: InstanceAttribute[],
): InstancedQuads {
  // Per-instance stride in floats; cached for setInstanceData
  // validation.
  const stride_floats = instance_attributes.reduce((acc, a) => acc + a.size, 0);
  if (stride_floats === 0) {
    throw new Error("createInstancedQuads: at least one instance attribute required");
  }

  const vao = gl.createVertexArray();
  if (vao === null) throw new Error("gl.createVertexArray returned null");
  gl.bindVertexArray(vao);

  // Quad-corner geometry buffer — bound to `a_corner` once at setup.
  const corner_buffer = gl.createBuffer();
  if (corner_buffer === null) throw new Error("gl.createBuffer (corner) returned null");
  gl.bindBuffer(gl.ARRAY_BUFFER, corner_buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);
  const corner_loc = shader.getAttribLocation("a_corner");
  if (corner_loc < 0) {
    throw new Error(
      "createInstancedQuads: shader has no `in vec2 a_corner;` attribute. The kit's quad geometry binds to it.",
    );
  }
  gl.enableVertexAttribArray(corner_loc);
  gl.vertexAttribPointer(corner_loc, 2, gl.FLOAT, false, 0, 0);

  // Per-instance buffer — interleaved, all attributes back-to-back per
  // instance. Sized 0 initially; setInstanceData grows it as needed.
  const instance_buffer = gl.createBuffer();
  if (instance_buffer === null) throw new Error("gl.createBuffer (instance) returned null");
  gl.bindBuffer(gl.ARRAY_BUFFER, instance_buffer);

  let offset = 0;
  const stride_bytes = stride_floats * Float32Array.BYTES_PER_ELEMENT;
  for (const attr of instance_attributes) {
    const loc = shader.getAttribLocation(attr.name);
    if (loc < 0) {
      throw new Error(
        `createInstancedQuads: shader has no attribute \`${attr.name}\`. ` +
        `Declared in instance_attributes but missing from vertex shader.`,
      );
    }
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, attr.size, gl.FLOAT, false, stride_bytes, offset);
    gl.vertexAttribDivisor(loc, 1);  // advance per-instance, not per-vertex
    offset += attr.size * Float32Array.BYTES_PER_ELEMENT;
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  let instance_count = 0;

  return {
    setInstanceData: (data, count) => {
      const expected = count * stride_floats;
      if (data.length < expected) {
        throw new Error(
          `setInstanceData: data.length=${data.length} < count*stride=${expected}`,
        );
      }
      instance_count = count;
      gl.bindBuffer(gl.ARRAY_BUFFER, instance_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    },
    draw: () => {
      if (instance_count === 0) return;
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instance_count);
      gl.bindVertexArray(null);
    },
    destroy: () => {
      gl.deleteBuffer(corner_buffer);
      gl.deleteBuffer(instance_buffer);
      gl.deleteVertexArray(vao);
    },
  };
}
