/* Live dev viewer for the fractal dive (S117) — auto-dives the misiu-spiral
 * Misiurewicz point with cyclic cosine coloring, and lets every knob that will
 * become a lens tunable (palette / period / SSAA / resolution / iter budget /
 * dive speed) be dialed by eye. Scroll/wheel scrubs depth (the eventual
 * scroll-as-zoom interaction). Pure lib/fractal underneath — no substrate yet.
 *
 * Serve: `npm run dev` then open http://localhost:5173/dev/fractal.html
 */
import {
  renderFractal,
  CYCLIC_PALETTES,
  CYCLIC_PALETTE_NAMES,
} from "@/lib/fractal";

// The locked dive center — a Misiurewicz point with self-similar detail at every
// scale, 0% interior to the float64 wall (~1e13). See tests/fractal-dive-probe.
const CENTER = { re: -0.10109636384562, im: 0.95628651080914 };
const DEPTH_MAX = 12.6; // log10(zoom) ceiling — past here float64 pixels collapse

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d")!;
// Offscreen compute buffer (rendered at SSAA resolution, then drawn down).
const off = document.createElement("canvas");
const offCtx = off.getContext("2d")!;

// ── live state (the future tunables) ─────────────────────────────────────────
const state = {
  palette: "ink",
  period: 32,
  ssaa: 2,
  renderShort: 360, // internal image short edge (CSS upscales to the window)
  iterBase: 200,
  iterPerDepth: 120, // max_iter grows with depth (deeper boundaries need more)
  diveSpeed: 60, // depth units ×0.001 per second (slider 0–200)
  auto: true,
  dir: 1 as 1 | -1,
  depth: 0,
};

// ── controls ─────────────────────────────────────────────────────────────────
const palSel = $<HTMLSelectElement>("palette");
for (const name of CYCLIC_PALETTE_NAMES) {
  const o = document.createElement("option");
  o.value = o.textContent = name;
  if (name === state.palette) o.selected = true;
  palSel.appendChild(o);
}
palSel.onchange = () => (state.palette = palSel.value);

function bindRange(id: string, key: keyof typeof state, fmt: (v: number) => string): void {
  const el = $<HTMLInputElement>(id);
  const out = $<HTMLSpanElement>(`${id}-v`);
  el.value = String(state[key]);
  out.textContent = fmt(state[key] as number);
  el.oninput = () => {
    (state[key] as number) = Number(el.value);
    out.textContent = fmt(Number(el.value));
  };
}
bindRange("period", "period", (v) => String(v));
bindRange("res", "renderShort", (v) => `${v}px`);
bindRange("iterbase", "iterBase", (v) => String(v));
bindRange("speed", "diveSpeed", (v) => String(v));
$<HTMLSelectElement>("ssaa").onchange = (e) =>
  (state.ssaa = Number((e.target as HTMLSelectElement).value));

const autoBtn = $<HTMLButtonElement>("auto");
autoBtn.onclick = () => {
  state.auto = !state.auto;
  autoBtn.textContent = state.auto ? "⏸ pause" : "▶ play";
};
$<HTMLButtonElement>("rev").onclick = () => (state.dir = (state.dir * -1) as 1 | -1);

// Scroll/wheel scrubs depth (down = deeper). Nudges the auto-dive in place.
window.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    state.depth = Math.max(0, Math.min(DEPTH_MAX, state.depth + e.deltaY * 0.0012));
  },
  { passive: false },
);

// ── render ───────────────────────────────────────────────────────────────────
function render(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const short = state.renderShort;
  const dispW = aspect >= 1 ? Math.round(short * aspect) : short;
  const dispH = aspect >= 1 ? short : Math.round(short / aspect);
  const cw = dispW * state.ssaa;
  const ch = dispH * state.ssaa;
  if (off.width !== cw || off.height !== ch) {
    off.width = cw;
    off.height = ch;
  }
  if (canvas.width !== dispW || canvas.height !== dispH) {
    canvas.width = dispW;
    canvas.height = dispH;
  }

  const zoom = Math.pow(10, state.depth);
  const max_iter = Math.round(state.iterBase + state.iterPerDepth * state.depth);
  const img = offCtx.createImageData(cw, ch);
  renderFractal(img.data, cw, ch, {
    mode: "mandelbrot",
    c_re: 0,
    c_im: 0,
    center_re: CENTER.re,
    center_im: CENTER.im,
    zoom,
    max_iter,
    palette: "fire", // unused in cyclic mode
    smooth: true,
    color_density: 0.35,
    cyclic: { period: state.period, palette: CYCLIC_PALETTES[state.palette]! },
  });
  offCtx.putImageData(img, 0, 0);
  // SSAA downsample (offscreen cw×ch → canvas dispW×dispH); CSS then upscales.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, dispW, dispH);
  ctx.drawImage(off, 0, 0, cw, ch, 0, 0, dispW, dispH);

  $<HTMLDivElement>("readout").textContent =
    `zoom 1e${state.depth.toFixed(2)} · iter ${max_iter} · ${cw}×${ch}→${dispW}×${dispH}`;
}

// ── loop ─────────────────────────────────────────────────────────────────────
let last = 0;
function frame(t: number): void {
  const dt = last ? (t - last) / 1000 : 0;
  last = t;
  if (state.auto) {
    state.depth += state.dir * state.diveSpeed * 0.001 * Math.min(dt, 0.05) * 20;
    if (state.depth >= DEPTH_MAX) {
      state.depth = DEPTH_MAX;
      state.dir = -1;
    } else if (state.depth <= 0) {
      state.depth = 0;
      state.dir = 1;
    }
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
