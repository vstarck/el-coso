/* 2D texture with float / byte formats. Used for substrate field
 * channels (R32F), color targets (RGBA8), and intermediate render
 * targets (any format).
 *
 * Allocation uses `texStorage2D` (the WebGL2 immutable-storage call)
 * so the driver knows the final size upfront. Per-frame uploads use
 * `texSubImage2D` to update without reallocating — critical for
 * field channels updated every tick.
 *
 * Sampling defaults: `clamp` wrap + `nearest` filter. Pass `repeat`
 * wrap when the substrate wraps on that axis (the kit doesn't infer);
 * pass `linear` when smooth field interpolation matters (requires
 * `OES_texture_float_linear` for float formats — universally
 * supported on conforming WebGL2 in 2026, no explicit check here).
 */

export type TextureFormat = "R32F" | "RG32F" | "RGBA32F" | "RGBA8";

export type TextureWrap = "clamp" | "repeat";
export type TextureFilter = "nearest" | "linear";

export type TextureOptions = {
  wrap_s?: TextureWrap;
  wrap_t?: TextureWrap;
  filter?: TextureFilter;
};

export type Texture = {
  texture: WebGLTexture;
  width: number;
  height: number;
  format: TextureFormat;
  bind: (unit: number) => void;
  uploadFloat: (data: Float32Array) => void;
  uploadBytes: (data: Uint8Array) => void;
  destroy: () => void;
};

type FormatTriple = {
  internal: number;       // GL_R32F, GL_RGBA8, ...
  format: number;         // GL_RED, GL_RGBA
  type: number;           // GL_FLOAT, GL_UNSIGNED_BYTE
  channels: number;       // 1, 2, 4
};

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: TextureFormat,
  options: TextureOptions = {},
): Texture {
  const triple = formatTriple(gl, format);

  const texture = gl.createTexture();
  if (texture === null) throw new Error("gl.createTexture returned null");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, triple.internal, width, height);

  const wrap_s = options.wrap_s === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  const wrap_t = options.wrap_t === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  const filter = options.filter === "linear" ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap_s);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap_t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

  return {
    texture,
    width,
    height,
    format,
    bind: (unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    },
    uploadFloat: (data) => {
      const expected = width * height * triple.channels;
      if (data.length !== expected) {
        throw new Error(
          `uploadFloat: data.length=${data.length} != width*height*channels=${expected}`,
        );
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, width, height,
        triple.format, triple.type, data,
      );
    },
    uploadBytes: (data) => {
      const expected = width * height * triple.channels;
      if (data.length !== expected) {
        throw new Error(
          `uploadBytes: data.length=${data.length} != width*height*channels=${expected}`,
        );
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, width, height,
        triple.format, triple.type, data,
      );
    },
    destroy: () => {
      gl.deleteTexture(texture);
    },
  };
}

function formatTriple(gl: WebGL2RenderingContext, format: TextureFormat): FormatTriple {
  switch (format) {
    case "R32F":    return { internal: gl.R32F,    format: gl.RED,  type: gl.FLOAT,         channels: 1 };
    case "RG32F":   return { internal: gl.RG32F,   format: gl.RG,   type: gl.FLOAT,         channels: 2 };
    case "RGBA32F": return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT,         channels: 4 };
    case "RGBA8":   return { internal: gl.RGBA8,   format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 };
  }
}
