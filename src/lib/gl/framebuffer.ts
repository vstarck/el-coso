/* Framebuffer Object — render-to-texture. Allocates an FBO with one
 * color attachment (a fresh Texture). Used by persistent-bitmap + post-process passes.
 *
 * `bind()` binds the FBO and sets the viewport to the FBO's size;
 * `unbind()` restores the default framebuffer (the canvas) and the
 * default viewport (matching the canvas backing size). The kit owns
 * this dance because forgetting to reset the viewport after FBO
 * draws is the load-bearing footgun.
 *
 * No depth or stencil. Substrates are 2D; layer ordering is explicit
 * via draw-call order. RGBA8 attachments are always supported;
 * RGBA32F requires `EXT_color_buffer_float` (queried in `context.ts`).
 */

import { createTexture, type Texture, type TextureFormat } from "./texture";

export type Framebuffer = {
  fbo: WebGLFramebuffer;
  texture: Texture;
  bind: () => void;
  unbind: () => void;
  destroy: () => void;
};

export function createFramebuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: TextureFormat,
): Framebuffer {
  const texture = createTexture(gl, width, height, format);

  const fbo = gl.createFramebuffer();
  if (fbo === null) throw new Error("gl.createFramebuffer returned null");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture.texture,
    0,
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    texture.destroy();
    throw new Error(`Framebuffer incomplete: status=0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    fbo,
    texture,
    bind: () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, width, height);
    },
    unbind: () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const canvas = gl.canvas as HTMLCanvasElement;
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    destroy: () => {
      gl.deleteFramebuffer(fbo);
      texture.destroy();
    },
  };
}
