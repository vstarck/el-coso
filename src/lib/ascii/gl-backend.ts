/* WebGL2 glyph-atlas backend — the no-ceiling renderer for large ascii grids.
 *
 * The Canvas2D atlas (canvas-atlas-backend.ts) is `drawImage`-count-bound: per-cell
 * corruption shatters a wall column into one blit per cell, and at hi-res + heavy
 * corruption that count exceeds the 16.7ms budget (S118 measurement). This backend
 * removes the ceiling: EVERY cell is one instance, drawn in ONE `drawArraysInstanced`
 * regardless of fragmentation, so render cost stops scaling with on-screen glyphs.
 *
 * A fixed, pre-packed glyph atlas (rasterized once at mount from `opts.glyphs`) is
 * sampled per-instance; per-cell fg/bg tints are uploaded each frame and the shader
 * does `mix(bg, fg, glyphAlpha)` in one pass. The atlas is colourless (white-on-
 * transparent) + fixed-resolution, so a theme swap or a resolution change never
 * rebuilds it — that is the win over the Canvas2D strip cache (which the shimmer
 * defeats). Slots behind the SurfaceRenderer seam with zero upstream change.
 *
 * See context/substrates/nm5/gl-backend-spec.md.
 */

import {
  createGLContext,
  createShader,
  createInstancedQuads,
  createTexture,
  type GLContext,
  type Shader,
  type InstancedQuads,
  type Texture,
} from "@/lib/gl";
import type { Surface } from "./surface";
import type { SurfaceRendererFactory } from "./renderer";
import { parseCssColor } from "./canvas-atlas-backend";

const DEFAULT_FONT = '"JetBrains Mono", ui-monospace, monospace';

// Atlas layout: 16×8 = 128 slots (slot 0 = tofu). Cells are fixed device-px, 1:2
// (w:h) to match the on-screen cell aspect; the shader scales per-quad, so this
// resolution is decoupled from the render resolution. 32×64 → a 512×512 texture.
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;
const ATLAS_CELL_W = 32;
const ATLAS_CELL_H = 64;
export const TOFU_GLYPH = "▯"; // slot 0 — the miss fallback

const MAX_COLOR_MEMO = 8192; // FIFO cap on the string→rgb parse memo (shimmer mints many)

export type GlyphIndex = {
  slots: string[]; // slot i → glyph (slot 0 = tofu)
  byGlyph: Map<string, number>;
  cols: number;
  rows: number;
};

// Pure: pack a glyph string into fixed atlas slots. Slot 0 is reserved for the
// tofu box (the render-time miss fallback). Iterates by CODE POINT (string
// iteration), so multi-unit glyphs occupy one slot. Dedups. A glyph past capacity
// warns and is dropped (→ tofu at render) rather than silently overwriting — a
// declared set that overflows 128 is an authoring bug (never-fail-silently).
export function buildGlyphIndex(
  glyphs: string,
  cols: number = ATLAS_COLS,
  rows: number = ATLAS_ROWS,
): GlyphIndex {
  const capacity = cols * rows;
  const slots: string[] = [TOFU_GLYPH];
  const byGlyph = new Map<string, number>();
  byGlyph.set(TOFU_GLYPH, 0);
  for (const g of glyphs) {
    if (byGlyph.has(g)) continue;
    if (slots.length >= capacity) {
      console.warn(
        `gl glyph atlas: glyph set exceeds ${capacity} slots — "${g}" dropped (renders as tofu). ` +
          `Trim opts.glyphs or grow the atlas grid.`,
      );
      continue;
    }
    byGlyph.set(g, slots.length);
    slots.push(g);
  }
  return { slots, byGlyph, cols, rows };
}

// Pure: atlas cell coordinates (col,row) of a slot — the (x,y) tile the shader's
// UV lands in. Exposed for the unit test.
export function slotCell(slot: number, cols: number = ATLAS_COLS): [number, number] {
  return [slot % cols, Math.floor(slot / cols)];
}

type ScratchCanvas = OffscreenCanvas | HTMLCanvasElement;
function createScratchCanvas(w: number, h: number): ScratchCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Rasterize the glyph set into an RGBA8 byte array (white glyph, alpha = coverage).
// Layout = the atlas grid; slot i at (i%cols·CELL_W, ⌊i/cols⌋·CELL_H). Row 0 of the
// byte array is the top of the canvas → texel v=0 (no UNPACK_FLIP), which the vertex
// shader's UV expects (screen-top corner samples v small = glyph top).
function rasterizeAtlas(index: GlyphIndex, font: string): Uint8Array {
  const texW = index.cols * ATLAS_CELL_W;
  const texH = index.rows * ATLAS_CELL_H;
  const canvas = createScratchCanvas(texW, texH);
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("gl glyph atlas: could not acquire 2d context for rasterization");
  ctx.clearRect(0, 0, texW, texH);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.floor(ATLAS_CELL_H * 0.82)}px ${font}`;
  for (let slot = 0; slot < index.slots.length; slot++) {
    const glyph = index.slots[slot]!;
    if (glyph === " " || glyph === "") continue; // blank cell — leave transparent
    const [cx, cy] = slotCell(slot, index.cols);
    ctx.fillText(
      glyph,
      cx * ATLAS_CELL_W + ATLAS_CELL_W / 2,
      cy * ATLAS_CELL_H + ATLAS_CELL_H / 2,
    );
  }
  const img = ctx.getImageData(0, 0, texW, texH);
  // getImageData yields a Uint8ClampedArray over a fresh buffer — reuse it as a
  // Uint8Array view (same bytes) to hand to uploadBytes.
  return new Uint8Array(img.data.buffer);
}

const VERT_SRC = `#version 300 es
in vec2 a_corner;            // kit quad corner, [-0.5, 0.5]
in float a_glyph;            // atlas slot index
in vec3 a_fg;
in vec3 a_bg;
uniform vec2 u_dims;         // cols, rows
uniform vec2 u_atlasGrid;    // atlas cols, rows
out vec2 v_uv;
flat out vec3 v_fg;
flat out vec3 v_bg;
void main() {
  int cols = int(u_dims.x);
  vec2 cell = vec2(float(gl_InstanceID % cols), float(gl_InstanceID / cols));
  vec2 p = cell + 0.5 + a_corner;                 // grid space, row 0 = top
  gl_Position = vec4(p.x / u_dims.x * 2.0 - 1.0,
                     1.0 - p.y / u_dims.y * 2.0,   // flip y (row 0 at top of screen)
                     0.0, 1.0);
  vec2 slot = vec2(mod(a_glyph, u_atlasGrid.x), floor(a_glyph / u_atlasGrid.x));
  v_uv = (slot + a_corner + 0.5) / u_atlasGrid;
  v_fg = a_fg;
  v_bg = a_bg;
}`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
flat in vec3 v_fg;
flat in vec3 v_bg;
uniform sampler2D u_atlas;
out vec4 outColor;
void main() {
  float a = texture(u_atlas, v_uv).a;
  outColor = vec4(mix(v_bg, v_fg, a), 1.0);
}`;

export const makeGlRenderer: SurfaceRendererFactory = (canvas, opts) => {
  canvas.width = opts.width;
  canvas.height = opts.height;
  const font = opts.font ?? DEFAULT_FONT;
  const index = buildGlyphIndex(opts.glyphs ?? "");

  let bg: [number, number, number] = opts.background
    ? (parseCssColor(opts.background).map((c) => c / 255) as [number, number, number])
    : [0, 0, 0];

  // GL resources — (re)created by build(), which re-runs on context restore.
  let ctx: GLContext | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let shader: Shader | null = null;
  let quads: InstancedQuads | null = null;
  let atlas: Texture | null = null;
  let lost = false;

  // Per-frame instance buffer: [glyph, fr,fg,fb, br,bg,bb] × cells. Grown on demand.
  let data = new Float32Array(0);
  let lastCells = 0;
  let lastInstances = 0;

  // string → rgb (0–1), FIFO-capped. nm5's distance-shading + shimmer mint many
  // distinct colour strings; same growth story as the Canvas2D `colourKeys`.
  const colorMemo = new Map<string, [number, number, number]>();
  function color(s: string | undefined, fallback: [number, number, number]): [number, number, number] {
    if (!s) return fallback;
    let c = colorMemo.get(s);
    if (c === undefined) {
      const [r, g, b] = parseCssColor(s);
      c = [r / 255, g / 255, b / 255];
      if (colorMemo.size >= MAX_COLOR_MEMO) {
        const oldest = colorMemo.keys().next().value;
        if (oldest !== undefined) colorMemo.delete(oldest);
      }
      colorMemo.set(s, c);
    }
    return c;
  }

  const warnedMisses = new Set<string>();
  function slotOf(glyph: string): number {
    const s = index.byGlyph.get(glyph);
    if (s !== undefined) return s;
    if (!warnedMisses.has(glyph)) {
      warnedMisses.add(glyph);
      console.warn(
        `gl glyph atlas: glyph "${glyph}" not in opts.glyphs — rendering tofu. ` +
          `Declare it in the renderer's glyph set.`,
      );
    }
    return 0; // tofu
  }

  function build(): void {
    ctx = createGLContext(canvas, {
      // No snapshot pipeline through this backend; the drawing buffer need not be
      // preserved, and MSAA on 1:1-texel glyph quads buys nothing.
      preserveDrawingBuffer: false,
      antialias: false,
      onLost: () => {
        lost = true;
      },
    });
    gl = ctx.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    shader = createShader(gl, VERT_SRC, FRAG_SRC);
    quads = createInstancedQuads(gl, shader, [
      { name: "a_glyph", size: 1 },
      { name: "a_fg", size: 3 },
      { name: "a_bg", size: 3 },
    ]);
    atlas = createTexture(gl, index.cols * ATLAS_CELL_W, index.rows * ATLAS_CELL_H, "RGBA8", {
      filter: "linear",
    });
    atlas.uploadBytes(rasterizeAtlas(index, font));
    gl.viewport(0, 0, canvas.width, canvas.height);
    lost = false;
  }

  function onRestored(): void {
    // Every GL resource was invalidated by the loss; rebuild them all.
    build();
    lastCells = 0; // force an instance-buffer re-upload
  }
  canvas.addEventListener("webglcontextrestored", onRestored);

  build();

  return {
    render(s: Surface): void {
      if (lost || !gl || !shader || !quads || !atlas) return;
      const cells = s.w * s.h;
      if (cells !== lastCells) {
        data = new Float32Array(cells * 7);
        lastCells = cells;
      }
      const fallbackFg: [number, number, number] = [1, 1, 1];
      const fallbackBg: [number, number, number] = bg;
      for (let i = 0; i < cells; i++) {
        const cell = s.cells[i];
        const o = i * 7;
        if (!cell) {
          data[o] = 0;
          data[o + 1] = fallbackFg[0];
          data[o + 2] = fallbackFg[1];
          data[o + 3] = fallbackFg[2];
          data[o + 4] = fallbackBg[0];
          data[o + 5] = fallbackBg[1];
          data[o + 6] = fallbackBg[2];
          continue;
        }
        data[o] = slotOf(cell.glyph);
        const fg = color(cell.fg, fallbackFg);
        const cbg = color(cell.bg, fallbackBg);
        data[o + 1] = fg[0];
        data[o + 2] = fg[1];
        data[o + 3] = fg[2];
        data[o + 4] = cbg[0];
        data[o + 5] = cbg[1];
        data[o + 6] = cbg[2];
      }

      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      shader.use();
      atlas.bind(0);
      shader.setUniform1i("u_atlas", 0);
      shader.setUniform2f("u_dims", s.w, s.h);
      shader.setUniform2f("u_atlasGrid", index.cols, index.rows);
      quads.setInstanceData(data, cells);
      quads.draw();
      lastInstances = cells;
    },
    resize(w: number, h: number): void {
      canvas.width = w;
      canvas.height = h;
      gl?.viewport(0, 0, w, h);
    },
    setBackground(colr: string): void {
      bg = parseCssColor(colr).map((c) => c / 255) as [number, number, number];
    },
    // Diagnostics for the `profile` console command. `instances` = cells drawn last
    // frame (always in ONE draw call — the whole point vs the atlas's blitCalls).
    // `slots` = packed glyph count; `colourKeys` = live parse-memo size.
    stats(): Record<string, number> {
      return {
        instances: lastInstances,
        drawCalls: lastInstances > 0 ? 1 : 0,
        slots: index.slots.length,
        colourKeys: colorMemo.size,
      };
    },
    dispose(): void {
      canvas.removeEventListener("webglcontextrestored", onRestored);
      quads?.destroy();
      shader?.destroy();
      atlas?.destroy();
      ctx?.destroy();
      colorMemo.clear();
    },
  };
};
