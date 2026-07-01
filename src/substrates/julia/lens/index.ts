/* Julia lens — the escape-time renderer (the non-trivial forward operator) over
 * a morphing parameter c. Two lenses ship from one mount via a painter seam:
 *   • "Escape"     — Canvas 2D (CPU, float64): recompute-on-change, capped buffer
 *   • "Escape · GL" — WebGL2 fragment shader (GPU, float32): full-res, every frame
 * Flip them in the toolbar lens picker and watch the fps readout — the GL path
 * stays pinned while c morphs / you drag; the CPU path janks on big recomputes
 * but zooms deeper before pixelating (float64 vs float32).
 *
 * The view tunables ARE the lens vocabulary: `max_iter` is slice thickness,
 * `color_density` the (max-iter-independent) contrast, `palette` the coloring,
 * `zoom`/`center` the framing, `mode` flips Julia ↔ its Mandelbrot atlas. Pan =
 * drag, zoom = wheel (cursor-anchored). The guake console (withConsole) drives
 * all of it as text.
 */

import { historyAdvance, historyTick } from "@/history";
import type {
  FractalMode,
  JuliaCommitPayload,
  JuliaConfig,
  JuliaInputs,
  SubstrateState,
} from "../engine";
import { COMMIT_PERIOD } from "../engine";
import type { Params, SpeedOption } from "@/lib/types";
import type {
  Cadence,
  CommitGlyph,
  EmbedCommandSpec,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  TunableValue,
} from "@/lenses/types";
import { withConsole } from "@/lenses/withConsole";
import {
  BASE_SPAN,
  PALETTE_NAMES,
  renderFractal,
  type PaletteName,
} from "@/lib/fractal";
import {
  makeCanvas2dPainter,
  makeGlPainter,
  type JuliaPainter,
} from "./painter";

const ACCENT = "#7dd3fc";

// Internal buffer cap (long edge, px) — bounds the CPU painter's per-recompute
// cost regardless of viewport size. The GL painter is cheap at any size but
// shares the cap so the comparison renders the same pixel count.
const MAX_BUF = 480;

const SPEEDS: SpeedOption[] = [
  { id: "0.1x", label: "⅒x", mult: 0.1 },
  { id: "0.25x", label: "¼x", mult: 0.25, isDefault: true },
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  { id: "max_iter", group: "Lens", label: "Iterations (slice thickness)", type: "int", min: 16, max: 800, step: 8, target: "lens", path: ["max_iter"] },
  { id: "zoom", group: "Lens", label: "Zoom", type: "float", min: 0.5, max: 40, step: 0.5, target: "lens", path: ["zoom"] },
  { id: "color_density", group: "Lens", label: "Color density", type: "float", min: 0.05, max: 1, step: 0.01, target: "lens", path: ["color_density"] },
  { id: "palette", group: "Lens", label: "Palette", type: "enum", options: [...PALETTE_NAMES], target: "lens", path: ["palette"] },
  { id: "smooth", group: "Lens", label: "Smooth coloring", type: "bool", target: "lens", path: ["smooth"] },
  { id: "mode", group: "Lens", label: "Mode", type: "enum", options: ["julia", "mandelbrot"], target: "lens", path: ["mode"] },
];

const COMMAND_SPECS: EmbedCommandSpec[] = [
  { name: "c", label: "steer the parameter (pauses)", args: [{ name: "re", type: "number" }, { name: "im", type: "number" }] },
  { name: "iters", label: "set iteration budget", args: [{ name: "n", type: "number" }] },
  { name: "zoom", label: "set zoom factor", args: [{ name: "factor", type: "number" }] },
  { name: "density", label: "color contrast (max-iter independent)", args: [{ name: "v", type: "number" }] },
  { name: "center", label: "recenter the view", args: [{ name: "re", type: "number" }, { name: "im", type: "number" }] },
  { name: "palette", label: "fire | ice | structure", args: [{ name: "name", type: "string" }] },
  { name: "mode", label: "julia | mandelbrot", args: [{ name: "name", type: "string" }] },
  { name: "smooth", label: "toggle smooth coloring" },
  { name: "reset", label: "recenter + default zoom" },
  { name: "pause", label: "stop the orbit" },
  { name: "play", label: "resume the orbit" },
];

type LensState = {
  max_iter: number;
  zoom: number;
  center_re: number;
  center_im: number;
  palette: PaletteName;
  smooth: boolean;
  color_density: number;
  mode: FractalMode;
};

// The shared mount — everything except pixel production, which the supplied
// painter owns (Canvas 2D or WebGL). Both lenses call this.
function mountJulia(
  args: LensMountArgs<SubstrateState, JuliaConfig, JuliaInputs, JuliaCommitPayload>,
  makePainter: (canvas: HTMLCanvasElement) => JuliaPainter,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;
  const config = history.config;

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.cursor = "grab";
  container.appendChild(canvas);

  const painter = makePainter(canvas);

  let speed_mult = 0.25;

  const lens_state: LensState = {
    max_iter: 120,
    zoom: 1,
    center_re: config.mode === "mandelbrot" ? -0.6 : 0,
    center_im: 0,
    palette: "fire",
    smooth: true,
    color_density: 0.25,
    mode: config.mode,
  };

  // --- buffer sizing: cap the internal resolution, CSS scales it to fill ---
  let buf_w = config.res;
  let buf_h = config.res;
  let last_sig = "";

  function resizeBuffer(): void {
    const cw = container.clientWidth || config.res;
    const ch = container.clientHeight || config.res;
    const aspect = cw / ch;
    let w = aspect >= 1 ? Math.round(config.res * aspect) : config.res;
    let h = aspect >= 1 ? config.res : Math.round(config.res / aspect);
    const long = Math.max(w, h);
    if (long > MAX_BUF) {
      const k = MAX_BUF / long;
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    buf_w = Math.max(1, w);
    buf_h = Math.max(1, h);
    canvas.width = buf_w;
    canvas.height = buf_h;
    last_sig = ""; // force a repaint at the new size
  }
  resizeBuffer();
  const resizeObserver = new ResizeObserver(() => resizeBuffer());
  resizeObserver.observe(container);

  // --- render (cached by signature; repaint only when something changed) ---
  function renderFrom(state: SubstrateState): void {
    const s = lens_state;
    const sig = `${s.mode}|${s.max_iter}|${s.zoom}|${s.center_re}|${s.center_im}|${s.palette}|${s.smooth}|${s.color_density}|${buf_w}|${buf_h}|${state.c_re}|${state.c_im}`;
    if (sig === last_sig) return;
    last_sig = sig;
    painter.render(
      {
        mode: s.mode,
        c_re: state.c_re,
        c_im: state.c_im,
        center_re: s.center_re,
        center_im: s.center_im,
        zoom: s.zoom,
        max_iter: s.max_iter,
        palette: s.palette,
        smooth: s.smooth,
        color_density: s.color_density,
      },
      buf_w,
      buf_h,
    );
  }

  // --- pan (drag) + zoom (wheel, cursor-anchored) ---
  let dragging = false;
  let drag_x0 = 0;
  let drag_y0 = 0;
  let drag_cre = 0;
  let drag_cim = 0;
  function cssScale(): number {
    const short = Math.min(container.clientWidth, container.clientHeight) || config.res;
    return BASE_SPAN / lens_state.zoom / short;
  }
  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    drag_x0 = e.clientX;
    drag_y0 = e.clientY;
    drag_cre = lens_state.center_re;
    drag_cim = lens_state.center_im;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const sc = cssScale();
    lens_state.center_re = drag_cre - (e.clientX - drag_x0) * sc;
    lens_state.center_im = drag_cim - (e.clientY - drag_y0) * sc;
    notifyTunables();
  }
  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    canvas.style.cursor = "grab";
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const sc = cssScale();
    const pre = lens_state.center_re + (cx - rect.width / 2) * sc;
    const pim = lens_state.center_im + (cy - rect.height / 2) * sc;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    lens_state.zoom = Math.max(0.2, Math.min(4000, lens_state.zoom * factor));
    const sc2 = cssScale();
    lens_state.center_re = pre - (cx - rect.width / 2) * sc2;
    lens_state.center_im = pim - (cy - rect.height / 2) * sc2;
    notifyTunables();
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // --- tunable message-passing (chrome Rules rail) ---
  const tunableListeners = new Set<() => void>();
  function notifyTunables(): void {
    for (const cb of tunableListeners) cb();
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0]!;
    if (!(key in lens_state)) return undefined;
    const v = (lens_state as unknown as Record<string, unknown>)[key];
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
    return undefined;
  }
  function setTunable(path: string[], value: TunableValue): void {
    if (path.length !== 1) return;
    const key = path[0]!;
    if (!(key in lens_state)) return;
    (lens_state as unknown as Record<string, unknown>)[key] = value;
    notifyTunables();
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => {
      tunableListeners.delete(listener);
    };
  }

  // --- console commands ---
  function command(name: string, a: unknown[]): void {
    const num = (i: number, fallback: number): number =>
      typeof a[i] === "number" ? (a[i] as number) : fallback;
    switch (name) {
      case "c":
        history.substrate.read.c_re = num(0, history.substrate.read.c_re);
        history.substrate.read.c_im = num(1, history.substrate.read.c_im);
        host.setPlaying(false);
        break;
      case "iters":
        lens_state.max_iter = Math.max(8, Math.min(2000, Math.round(num(0, lens_state.max_iter))));
        notifyTunables();
        break;
      case "zoom":
        lens_state.zoom = Math.max(0.2, Math.min(4000, num(0, lens_state.zoom)));
        notifyTunables();
        break;
      case "density":
        lens_state.color_density = Math.max(0.01, Math.min(2, num(0, lens_state.color_density)));
        notifyTunables();
        break;
      case "center":
        lens_state.center_re = num(0, lens_state.center_re);
        lens_state.center_im = num(1, lens_state.center_im);
        notifyTunables();
        break;
      case "palette": {
        const p = String(a[0] ?? "");
        if (!(PALETTE_NAMES as string[]).includes(p)) {
          throw new Error(`unknown palette: ${p} — try ${PALETTE_NAMES.join(" / ")}`);
        }
        lens_state.palette = p as PaletteName;
        notifyTunables();
        break;
      }
      case "mode": {
        const m = String(a[0] ?? "");
        if (m !== "julia" && m !== "mandelbrot") {
          throw new Error(`unknown mode: ${m} — julia | mandelbrot`);
        }
        lens_state.mode = m;
        notifyTunables();
        break;
      }
      case "smooth":
        lens_state.smooth = !lens_state.smooth;
        notifyTunables();
        break;
      case "reset":
        lens_state.center_re = lens_state.mode === "mandelbrot" ? -0.6 : 0;
        lens_state.center_im = 0;
        lens_state.zoom = 1;
        notifyTunables();
        break;
      case "play":
        host.setPlaying(true);
        break;
      case "pause":
        host.setPlaying(false);
        break;
      default:
        throw new Error(`unknown command: ${name}`);
    }
  }

  // --- tick (autonomous, with replay) ---
  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur = history.substrate.read.tick;
    if (cur < active.head_tick) {
      historyAdvance(history, {});
      host.setPlayheadTick(history.substrate.read.tick);
      return;
    }
    historyTick(history, {});
    const st = history.substrate.read;
    host.setPlayheadTick(st.tick);
    if (st.tick % COMMIT_PERIOD === 0) host.bumpHistoryVersion();
  }

  // Thumbnails always render on the chrome-supplied 2D target canvas (cheap,
  // small) regardless of which painter the live lens uses.
  function renderThumbnail(state: SubstrateState, target: HTMLCanvasElement): void {
    const tctx = target.getContext("2d");
    if (!tctx) return;
    const w = target.width;
    const h = target.height;
    const data = tctx.createImageData(w, h);
    renderFractal(data.data, w, h, {
      mode: lens_state.mode,
      c_re: state.c_re,
      c_im: state.c_im,
      center_re: lens_state.center_re,
      center_im: lens_state.center_im,
      zoom: lens_state.zoom,
      max_iter: Math.min(lens_state.max_iter, 160),
      palette: lens_state.palette,
      smooth: lens_state.smooth,
      color_density: lens_state.color_density,
    });
    tctx.putImageData(data, 0, 0);
  }

  function commitGlyph(payload: Params): CommitGlyph {
    const re = typeof payload["c_re"] === "number" ? (payload["c_re"] as number) : 0;
    const im = typeof payload["c_im"] === "number" ? (payload["c_im"] as number) : 0;
    const hue = ((Math.atan2(im, re) * 180) / Math.PI + 360) % 360;
    return { kind: "disc", color: `hsl(${hue} 70% 60%)` };
  }

  return {
    unmount: () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      painter.destroy();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    snapshot: () => canvas,
    renderThumbnail,
    commitGlyph,
    pause: () => { host.setPlaying(false); },
    resume: () => { host.setPlaying(true); },
    step: () => { host.setPlaying(false); doOneTick(); },
    setSpeed: (id: string) => {
      const o = SPEEDS.find((s) => s.id === id);
      if (o) speed_mult = o.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
    command,
  };
}

// Shared static lens shape; the two lenses differ only in id/name/painter.
function lensShape(
  id: string,
  name: string,
  target_kind: "canvas2d" | "webgl",
  makePainter: (canvas: HTMLCanvasElement) => JuliaPainter,
): Lens<SubstrateState, JuliaConfig, JuliaInputs, JuliaCommitPayload> {
  return {
    id,
    name,
    tunables: TUNABLES,
    speeds: SPEEDS,
    cadence: CADENCE,
    target_kind,
    // AUTOPLAY — rAF drives the morph. FLAT — the lens owns its complex-plane
    // projection. SINGLE_BRANCH — deterministic + no recorded input.
    features: ["AUTOPLAY", "FLAT", "SINGLE_BRANCH"],
    theme: { accent: ACCENT },
    commands: COMMAND_SPECS,
    mount: (args) => mountJulia(args, makePainter),
  };
}

// Two lenses, one mount: CPU (Canvas 2D) and GPU (WebGL). Flip in the toolbar
// lens picker to compare framerate. Both adopt the guake console.
export const juliaLens = withConsole(lensShape("julia-grid", "Escape", "canvas2d", makeCanvas2dPainter));
export const juliaGlLens = withConsole(lensShape("julia-gl", "Escape · GL", "webgl", makeGlPainter));
