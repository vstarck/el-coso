/* Painter seam — the only thing that differs between the two julia lenses.
 * Both produce the same image from the same `RenderParams`; one does it on the
 * CPU (Canvas 2D `putImageData`), the other on the GPU (a WebGL2 fragment
 * shader). The lens mount owns everything else (sizing, tunables, pan/zoom,
 * console, tick) and just hands pixel production to a painter — so the A/B is
 * apples-to-apples and there's no duplicated scaffold.
 */

import {
  createFullScreenPass,
  createGLContext,
  createShader,
} from "@/lib/gl";
import {
  planeToPixel,
  renderFractal,
  type PaletteName,
  type RenderParams,
} from "@/lib/fractal";

export type JuliaPainter = {
  // Paint the current params into a w×h buffer on the painter's canvas.
  render(p: RenderParams, w: number, h: number): void;
  destroy(): void;
};

// ── Canvas 2D painter (CPU, JS float64) ──────────────────────────────────────
export function makeCanvas2dPainter(canvas: HTMLCanvasElement): JuliaPainter {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("julia: could not acquire 2d context");
  let image: ImageData | null = null;
  return {
    render(p, w, h) {
      if (!image || image.width !== w || image.height !== h) {
        image = ctx.createImageData(w, h);
      }
      renderFractal(image.data, w, h, p);
      ctx.putImageData(image, 0, 0);
      if (p.mode === "mandelbrot") {
        const m = planeToPixel(p.c_re, p.c_im, w, h, p.center_re, p.center_im, p.zoom);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    destroy() {
      // nothing to release — the canvas/context outlives the painter
    },
  };
}

// ── WebGL2 painter (GPU, highp float32) ──────────────────────────────────────
const PALETTE_INDEX: Record<PaletteName, number> = { fire: 0, ice: 1, structure: 2 };

const VERT_SRC = `#version 300 es
in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

// The escape-time loop + palette + soft-saturation coloring, ported 1:1 from
// render.ts. The loop has a compile-time cap and breaks early at u_maxIter
// (GLSL needs a constant bound). highp float32 ⇒ deep zoom blurs out ~1e4
// (the CPU painter, float64, goes further) — the speed↔precision tradeoff.
const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_res;
uniform int u_mode;      // 0 julia, 1 mandelbrot
uniform vec2 u_c;
uniform vec2 u_center;
uniform float u_zoom;
uniform int u_maxIter;
uniform float u_density;
uniform int u_smooth;
uniform int u_palette;   // 0 fire, 1 ice, 2 structure

const float BASE_SPAN = 3.2;
const int CAP = 2000;

vec3 palette(int p, float t) {
  t = clamp(t, 0.0, 1.0);
  if (p == 0) {
    if (t < 0.25) return mix(vec3(0.0), vec3(90.,12.,8.)/255., t/0.25);
    if (t < 0.5)  return mix(vec3(90.,12.,8.)/255., vec3(210.,70.,12.)/255., (t-0.25)/0.25);
    if (t < 0.75) return mix(vec3(210.,70.,12.)/255., vec3(248.,186.,48.)/255., (t-0.5)/0.25);
    return mix(vec3(248.,186.,48.)/255., vec3(255.,255.,224.)/255., (t-0.75)/0.25);
  } else if (p == 1) {
    if (t < 0.3)  return mix(vec3(0.0), vec3(12.,32.,92.)/255., t/0.3);
    if (t < 0.6)  return mix(vec3(12.,32.,92.)/255., vec3(34.,116.,204.)/255., (t-0.3)/0.3);
    if (t < 0.85) return mix(vec3(34.,116.,204.)/255., vec3(126.,214.,242.)/255., (t-0.6)/0.25);
    return mix(vec3(126.,214.,242.)/255., vec3(244.,255.,255.)/255., (t-0.85)/0.15);
  }
  if (t < 0.5) return mix(vec3(8.,8.,12.)/255., vec3(122.,124.,134.)/255., t/0.5);
  return mix(vec3(122.,124.,134.)/255., vec3(246.,246.,250.)/255., (t-0.5)/0.5);
}

void main() {
  float shortEdge = min(u_res.x, u_res.y);
  float scale = BASE_SPAN / u_zoom / shortEdge;
  // match the CPU painter's orientation (im increases downward)
  vec2 px = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);
  vec2 plane = u_center + (px - 0.5 * u_res) * scale;

  vec2 z = (u_mode == 0) ? plane : vec2(0.0);
  vec2 c = (u_mode == 0) ? u_c : plane;

  float zr = z.x, zi = z.y;
  float zr2 = zr*zr, zi2 = zi*zi;
  int n = 0;
  for (int i = 0; i < CAP; i++) {
    if (i >= u_maxIter) break;
    if (zr2 + zi2 > 4.0) break;
    zi = 2.0*zr*zi + c.y;
    zr = zr2 - zi2 + c.x;
    zr2 = zr*zr; zi2 = zi*zi;
    n++;
  }

  vec3 col;
  if (n >= u_maxIter) {
    col = vec3(0.0);
  } else {
    float cnt = float(n);
    if (u_smooth == 1) {
      float logZn = log(zr2 + zi2) * 0.5;
      float nu = log(logZn / log(2.0)) / log(2.0);
      cnt = clamp(float(n) + 1.0 - nu, 0.0, float(u_maxIter));
    }
    float t = 1.0 - exp(-sqrt(max(cnt, 0.0)) * u_density);
    col = palette(u_palette, t);
  }

  // Mandelbrot tour marker — a white ring at the current c.
  if (u_mode == 1) {
    float d = length(plane - u_c);
    if (abs(d - scale * 4.0) < scale * 0.9) col = vec3(1.0);
  }

  fragColor = vec4(col, 1.0);
}`;

export function makeGlPainter(canvas: HTMLCanvasElement): JuliaPainter {
  const glc = createGLContext(canvas, { antialias: false, preserveDrawingBuffer: true });
  const gl = glc.gl;
  const shader = createShader(gl, VERT_SRC, FRAG_SRC);
  const pass = createFullScreenPass(gl, shader);
  return {
    render(p, w, h) {
      gl.viewport(0, 0, w, h);
      shader.use();
      shader.setUniform2f("u_res", w, h);
      shader.setUniform1i("u_mode", p.mode === "mandelbrot" ? 1 : 0);
      shader.setUniform2f("u_c", p.c_re, p.c_im);
      shader.setUniform2f("u_center", p.center_re, p.center_im);
      shader.setUniform1f("u_zoom", p.zoom);
      shader.setUniform1i("u_maxIter", p.max_iter);
      shader.setUniform1f("u_density", p.color_density);
      shader.setUniform1i("u_smooth", p.smooth ? 1 : 0);
      shader.setUniform1i("u_palette", PALETTE_INDEX[p.palette]);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      pass.draw();
    },
    destroy() {
      pass.destroy();
      shader.destroy();
      glc.destroy();
    },
  };
}
