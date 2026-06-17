/* WebGL2 context acquisition — single source of truth for the
 * `WebGL2RenderingContext` every other kit primitive depends on. Wraps
 * `canvas.getContext("webgl2", {...})` with the project's defaults and
 * a `webglcontextlost` listener that calls `preventDefault()` so the
 * browser attempts restore.
 *
 * V1 strategy on context loss: the lens unmounts and re-mounts. The `onLost` callback fires after the
 * `webglcontextlost` event so the consumer can trigger the re-mount;
 * the kit itself does nothing else (every WebGL resource is invalid
 * after loss).
 *
 * Throws on WebGL2-unavailable browsers — degradation to WebGL1 is
 * foreclosed per the spec. The chrome surfaces a clear error message.
 */

export type GLContextOptions = {
  /** Required to make `canvas.toBlob` capture a non-blank image after
   * the next clear. Small perf cost (no double-buffer-flip-and-
   * discard). Defaults to true — snapshot is load-bearing for substrate-frame capture. */
  preserveDrawingBuffer?: boolean;
  /** MSAA on the default framebuffer. Defaults to true. Render-to-
   * texture (FBO) does NOT get MSAA unless the FBO is set up with
   * `renderbufferStorageMultisample` (kit does not). */
  antialias?: boolean;
  /** Defaults to true. Matches Canvas 2D's `globalAlpha` semantics
   * for source-over blending. */
  premultipliedAlpha?: boolean;
  /** Called after the `webglcontextlost` event fires. The kit's
   * primitives are all invalid by this point; the consumer should
   * trigger a re-mount. */
  onLost?: () => void;
};

export type GLContext = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  destroy: () => void;
};

export function createGLContext(
  canvas: HTMLCanvasElement,
  options: GLContextOptions = {},
): GLContext {
  const gl = canvas.getContext("webgl2", {
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
    antialias: options.antialias ?? true,
    premultipliedAlpha: options.premultipliedAlpha ?? true,
  });
  if (gl === null) {
    throw new Error(
      "WebGL2 unavailable on this browser. A WebGL substrate-frame requires WebGL2 (universal since Safari 15, 2021).",
    );
  }

  // EXT_color_buffer_float — required to color-target a float texture
  // from an FBO (a persistent bitmap, any post-process pass
  // that wants float precision). Universally supported on conforming
  // WebGL2 implementations in 2026; the throw is for clarity, not
  // expected to fire in practice.
  if (gl.getExtension("EXT_color_buffer_float") === null) {
    console.warn(
      "EXT_color_buffer_float not available — float-format FBOs will fail. A basic substrate-frame does not need it; float-FBO consumers will.",
    );
  }

  function onContextLost(e: Event): void {
    e.preventDefault();
    options.onLost?.();
  }
  canvas.addEventListener("webglcontextlost", onContextLost);

  return {
    gl,
    canvas,
    destroy: () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
    },
  };
}
