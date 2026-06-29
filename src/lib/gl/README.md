# `src/lib/gl/` — shared WebGL2 lens helpers

**Chrome-tier. May import DOM, `WebGL2RenderingContext`. Not
translatable.**

Helpers for lenses whose render target is `webgl`. Picked by the
*design-questions pipeline* (Q1 = webgl → import the pieces you need
from here).

Designed up-front rather than extracted because several substrate-frame
consumers exist and WebGL's setup ceremony is fixed-cost per consumer.

## Primitives

- **`context.ts`** — `createGLContext(canvas, { preserveDrawingBuffer?,
  onLost? })` — WebGL2 acquisition + context-loss listener. Throws if
  WebGL2 unavailable.
- **`shader.ts`** — `createShader(gl, vs_src, fs_src)` — compile +
  link vertex and fragment stages. Throws on compile / link failure
  with INFO_LOG. Typed uniform setters; cached locations.
- **`texture.ts`** — `createTexture(gl, w, h, format, { wrap?, filter? })`
  — 2D texture in R32F / RG32F / RGBA32F / RGBA8.
  `uploadFloat` / `uploadBytes` for per-frame updates (no realloc).
- **`framebuffer.ts`** — `createFramebuffer(gl, w, h, format)` —
  render-to-texture. Color-only. `bind` / `unbind` handle viewport.
- **`camera.ts`** — `createCamera()` — 2D ortho projection matrix +
  click unprojection. Pan in canvas pixels (compatible with
  `attachPanDrag`); zoom in pixels per world unit.
- **`instanced-quads.ts`** — `createInstancedQuads(gl, shader,
  instance_attributes)` — many-instance quad draws in one call.
  Reserved per-vertex attribute: `a_corner` (vec2).
- **`full-screen-pass.ts`** — `createFullScreenPass(gl, shader)` —
  clip-space-aligned quad covering the viewport. For composite /
  post-process. Reserved: `a_corner` (vec2).

## Typical usage

A field-rendering lens uploads its per-cell channels into float
textures and draws them as a projected world quad (one fragment shader
samples every cell); moving entities and markers draw as
`InstancedQuads` with a shared point-sprite shader. A `Framebuffer` +
`FullScreenPass` layers fade / post-process passes on top.

The simplest case needs no textures or geometry at all: a lens whose image
is a **pure per-pixel function of a few uniforms** is just a `createShader`
+ `createFullScreenPass`, with the math in the fragment shader. `julia`'s
`Escape · GL` lens ([`src/substrates/julia/lens/painter.ts`](../../substrates/julia/lens/painter.ts))
is the worked reference — an escape-time fractal as one full-screen pass,
sharing its mount with a Canvas 2D twin so you can A/B CPU vs GPU.

## Still longhand (extract when needed)

- A `TextureQuad` primitive (single projected textured quad) —
  hand-rolled where it's a one-off shape today; promote to the kit
  when a second consumer wants the same.
- Ping-pong framebuffer (two FBOs swapped each frame for iterative
  passes — fade-into-self). Extract when a consumer needs it.
