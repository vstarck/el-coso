/* abismo lens — the infinite dive. State is one scalar `depth` (log10 zoom);
 * the lens turns it into a Mandelbrot frame at the fixed Misiurewicz center via
 * the shared `lib/fractal` cyclic-cosine renderer (CPU float64 — the only path
 * that reaches 1e12; a GL float32 shader blurs out by ~1e4). Scroll drives the
 * dive (down = deeper, exactly reversible); when idle it auto-dives and hands
 * control to the reader on the first wheel event.
 *
 *   Q1 render target?   a <canvas> (SSAA-downsampled fractal), fills the frame.
 *   Q2 viewport?        FLAT — the lens owns its complex-plane projection.
 *   Q3 storage?         one float `depth` (+ tick). Everything is f(depth).
 *   Q4 agency?          scroll = depth (or the auto-dive). No pan, no win.
 *   Q5 pace?            autonomous (auto-dive; host owns rAF).
 *   Q6 commit shape?    heartbeat — a disc whose hue tracks dive depth.
 *
 * Host-agnostic (talks only through the injected LensHost) ⇒ exports React-free.
 */

import { historyAdvance, historyReset, historyTick } from "@/history";
import type { Params, SpeedOption } from "@/lib/types";
import type {
  Cadence,
  CommitGlyph,
  EmbedCommandSpec,
  HudMetric,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  TunableValue,
} from "@/lenses/types";
import { withConsole } from "@/lenses/withConsole";
import { CYCLIC_PALETTE_NAMES } from "@/lib/fractal";
import type {
  AbismoCommitPayload,
  AbismoConfig,
  AbismoInputs,
  SubstrateState,
} from "../engine";
import { COMMIT_PERIOD } from "../engine";
import { makeDivePainter, type DivePainter } from "./painter";
import {
  attachScroll,
  DEFAULT_SCROLL_SENSITIVITY,
  MAX_SCROLL_SENSITIVITY,
  MIN_SCROLL_SENSITIVITY,
  type ScrollInput,
} from "./input";

const ACCENT = "#8be0ff";

// Render short-edge bounds (px). The compute cost is (short·aspect·ssaa) ×
// (short·ssaa) × max_iter; these bound it while leaving crispness to the user.
const RES_MIN = 200;
const RES_MAX = 720;
const PERIOD_MIN = 4;
const PERIOD_MAX = 96;
const SSAA_MIN = 1;
const SSAA_MAX = 3;
const SPEED_MIN = 0;
const SPEED_MAX = 0.1;
const clampNum = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

// ── Reprojection tuning (zoom coherence — see painter.ts) ────────────────────
// The base is rendered MARGIN× wider than shown so a zoom-OUT can still crop from
// it (reprojection only ADDS magnification). log10(1.6) = 0.20 of zoom-out
// headroom absorbs the worker's render latency before the crop runs past the edge.
const MARGIN = 1.6;
// Re-anchor once the view has drifted this far from the base (either direction).
// 10^0.05 ≈ 1.12× magnification ⇒ imperceptibly soft between re-anchors. The
// worker gates the actual cadence: it can't keep up on deep frames, so the base
// just drifts a little softer during a deep dive (no stutter — it's off-thread).
const REANCHOR_DELTA = 0.05;

const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1, isDefault: true },
  { id: "2x", label: "2x", mult: 2 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  { id: "palette", group: "Lens", label: "Palette", type: "enum", options: [...CYCLIC_PALETTE_NAMES], target: "lens", path: ["palette"] },
  { id: "period", group: "Lens", label: "Colour period", type: "int", min: PERIOD_MIN, max: PERIOD_MAX, step: 1, target: "lens", path: ["period"] },
  { id: "ssaa", group: "Lens", label: "Supersampling", type: "int", min: SSAA_MIN, max: SSAA_MAX, step: 1, unit: "×", target: "lens", path: ["ssaa"] },
  { id: "resolution", group: "Lens", label: "Resolution", type: "int", min: RES_MIN, max: RES_MAX, step: 20, unit: "px", target: "lens", path: ["resolution"] },
  { id: "dive_speed", group: "Lens", label: "Auto-dive speed", type: "float", min: SPEED_MIN, max: SPEED_MAX, step: 0.002, unit: "depth/tick", target: "lens", path: ["dive_speed"] },
  { id: "scroll_sensitivity", group: "Lens", label: "Scroll sensitivity", type: "float", min: MIN_SCROLL_SENSITIVITY, max: MAX_SCROLL_SENSITIVITY, step: 0.0002, unit: "depth/px", target: "lens", path: ["scroll_sensitivity"] },
];

const COMMAND_SPECS: EmbedCommandSpec[] = [
  { name: "auto", label: "toggle self-dive" },
  { name: "surface", label: "back to zoom 1 (depth 0)" },
  { name: "palette", label: `set palette (${CYCLIC_PALETTE_NAMES.join(" · ")})`, args: [{ name: "name", type: "string" }] },
];

const AUTOPILOT_DEFAULT_ON = true;

type LensState = {
  palette: string;
  period: number;
  ssaa: number;
  resolution: number;
  dive_speed: number;
  scroll_sensitivity: number;
};

function mountAbismo(
  args: LensMountArgs<SubstrateState, AbismoConfig, AbismoInputs, AbismoCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;
  const config = history.config;

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const painter: DivePainter = makeDivePainter(canvas);

  const lens_state: LensState = {
    palette: config.palette,
    period: config.period,
    ssaa: 2,
    resolution: 360,
    dive_speed: config.dive_speed,
    scroll_sensitivity: DEFAULT_SCROLL_SENSITIVITY,
  };

  let autopilot = AUTOPILOT_DEFAULT_ON;
  let dir: 1 | -1 = 1; // auto-dive direction (ping-pongs at the depth bounds)
  let speed_mult = 1;
  // Reprojection state (zoom coherence). `baseDirty` forces a re-anchor even when
  // the depth hasn't moved — a tunable/resize change made the current base stale.
  // It does NOT drop the base: present keeps reprojecting the old frame until the
  // fresh one arrives, so a palette/resolution change never black-flashes.
  let baseDirty = false;
  let curW = 0;
  let curH = 0;
  function invalidateBase(): void {
    baseDirty = true;
  }

  const scrollInput: ScrollInput = attachScroll(container, () => {
    if (autopilot) {
      autopilot = false; // first real scroll hands the dive to the reader
      host.setPlaying(true);
    }
  });
  scrollInput.setSensitivity(lens_state.scroll_sensitivity);

  // --- render (gated by signature; repaint only when depth or a knob changed) ---
  function dispSize(): { w: number; h: number } {
    const cw = container.clientWidth || lens_state.resolution;
    const ch = container.clientHeight || lens_state.resolution;
    const aspect = cw / ch;
    const short = lens_state.resolution;
    return aspect >= 1
      ? { w: Math.round(short * aspect), h: short }
      : { w: short, h: Math.round(short / aspect) };
  }
  // Every frame: present the base reprojected to the current depth (cheap, always
  // 60fps). When the worker is free and the view has drifted (or a tunable made
  // the base stale), request a fresh base — off-thread, so this never blocks. See
  // painter.ts.
  function renderFrom(state: SubstrateState): void {
    const depth = state.depth;
    const { w, h } = dispSize();
    if (w !== curW || h !== curH) {
      baseDirty = true; // viewport resized — re-anchor at the new size
      curW = w;
      curH = h;
    }

    if (!painter.isPending()) {
      const drift = Math.abs(depth - painter.baseDepth());
      if (baseDirty || !painter.hasBase() || drift > REANCHOR_DELTA) {
        baseDirty = false;
        painter.requestBase({
          center_re: config.center_re,
          center_im: config.center_im,
          depth,
          dispW: w,
          dispH: h,
          ssaa: lens_state.ssaa,
          margin: MARGIN,
          iter_base: config.iter_base,
          iter_per_depth: config.iter_per_depth,
          period: lens_state.period,
          palette: lens_state.palette,
          color_density: config.color_density,
        });
      }
    }
    painter.present(depth, w, h);
  }

  // --- tick: integrate scroll (or the auto-dive) into depth, with replay ---
  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur = history.substrate.read.tick;
    if (cur < active.head_tick) {
      // Replaying recorded history — reapply the stored scrollDelta exactly.
      historyAdvance(history, { scrollDelta: 0 });
      host.setPlayheadTick(history.substrate.read.tick);
      return;
    }
    let scrollDelta = scrollInput.drain();
    if (autopilot && scrollDelta === 0) {
      const depth = history.substrate.read.depth;
      if (depth >= config.depth_max) dir = -1;
      else if (depth <= 0) dir = 1;
      scrollDelta = dir * lens_state.dive_speed;
    }
    historyTick(history, { scrollDelta });
    const st = history.substrate.read;
    host.setPlayheadTick(st.tick);
    if (st.tick % COMMIT_PERIOD === 0) host.bumpHistoryVersion();
  }

  // --- tunables (chrome Rules rail + embed SDK) — one validated gate ---
  const tunableListeners = new Set<() => void>();
  function notifyTunables(): void {
    for (const cb of tunableListeners) cb();
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0]!;
    if (!(key in lens_state)) return undefined;
    const v = (lens_state as unknown as Record<string, unknown>)[key];
    return typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : undefined;
  }
  const finite = (v: TunableValue): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  // Validate + clamp EVERY write — reached raw from the console `set` built-in
  // (checks number-ness, not range) and the embed SDK (forwards host values
  // unchecked). An out-of-range or bogus value must not freeze the CPU painter
  // or throw inside renderFrom. See [[feedback-ascii-renderer-kit]].
  function setTunable(path: string[], value: TunableValue): void {
    if (path.length !== 1) return;
    const key = path[0]!;
    switch (key) {
      case "palette":
        if (typeof value === "string" && (CYCLIC_PALETTE_NAMES as string[]).includes(value)) {
          lens_state.palette = value;
        } else {
          console.warn(`abismo: ignoring invalid palette "${String(value)}"`);
          return;
        }
        break;
      case "period": {
        const n = finite(value);
        if (n !== null) lens_state.period = Math.round(clampNum(n, PERIOD_MIN, PERIOD_MAX));
        break;
      }
      case "ssaa": {
        const n = finite(value);
        if (n !== null) lens_state.ssaa = Math.round(clampNum(n, SSAA_MIN, SSAA_MAX));
        break;
      }
      case "resolution": {
        const n = finite(value);
        if (n !== null) lens_state.resolution = Math.round(clampNum(n, RES_MIN, RES_MAX));
        break;
      }
      case "dive_speed": {
        const n = finite(value);
        if (n !== null) lens_state.dive_speed = clampNum(n, SPEED_MIN, SPEED_MAX);
        break;
      }
      case "scroll_sensitivity": {
        const n = finite(value);
        if (n !== null) {
          lens_state.scroll_sensitivity = clampNum(n, MIN_SCROLL_SENSITIVITY, MAX_SCROLL_SENSITIVITY);
          scrollInput.setSensitivity(lens_state.scroll_sensitivity);
        }
        break;
      }
      default:
        return; // unknown tunable — ignore
    }
    // palette / period / ssaa / resolution change the rendered image ⇒ the base
    // is stale; dive_speed / scroll_sensitivity don't touch pixels.
    if (key === "palette" || key === "period" || key === "ssaa" || key === "resolution") {
      invalidateBase();
    }
    notifyTunables();
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  function setAuto(on: boolean): void {
    autopilot = on;
    if (on) host.setPlaying(true);
  }
  function surface(): void {
    historyReset(history);
    autopilot = AUTOPILOT_DEFAULT_ON;
    dir = 1;
    invalidateBase(); // depth jumps to 0 — re-anchor cleanly
    host.setPlayheadTick(0);
    host.bumpHistoryVersion();
    host.setPlaying(true);
  }

  // --- console commands (own verbs; transport/set/get/describe come free) ---
  function command(name: string, cmdArgs: unknown[]): string | void {
    switch (name) {
      case "auto":
        setAuto(!autopilot);
        break;
      case "surface":
        surface();
        break;
      case "palette": {
        const p = String(cmdArgs[0] ?? "");
        if (!(CYCLIC_PALETTE_NAMES as string[]).includes(p)) {
          throw new Error(`unknown palette: ${p} — try ${CYCLIC_PALETTE_NAMES.join(" / ")}`);
        }
        setTunable(["palette"], p);
        break;
      }
      default:
        throw new Error(`abismo: unknown command "${name}"`);
    }
  }

  function depthReadout(depth: number): string {
    return `1e${depth.toFixed(2)}`;
  }
  function commitGlyph(payload: Params): CommitGlyph {
    const depth = typeof payload["depth"] === "number" ? payload["depth"] : 0;
    const frac = config.depth_max > 0 ? depth / config.depth_max : 0;
    return { kind: "disc", color: `hsl(${Math.round(200 + frac * 140)} 80% 60%)` };
  }
  function hudMetrics(): HudMetric[] {
    const s = history.substrate.read;
    return [
      { id: "zoom", label: "zoom", value: depthReadout(s.depth) },
      { id: "mode", label: "dive", value: autopilot ? "auto" : "scroll" },
    ];
  }

  return {
    unmount: () => {
      scrollInput.detach();
      painter.destroy();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    snapshot: () => canvas,
    commitGlyph,
    hudMetrics,
    pause: () => host.setPlaying(false),
    resume: () => host.setPlaying(true),
    step: () => {
      host.setPlaying(false);
      doOneTick();
    },
    reset: surface,
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
    command,
  };
}

const abismoLensBase: Lens<SubstrateState, AbismoConfig, AbismoInputs, AbismoCommitPayload> = {
  id: "abismo-dive",
  name: "dive",
  tunables: TUNABLES,
  commands: COMMAND_SPECS,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "canvas2d",
  // FLAT full-bleed — the lens owns its complex-plane projection. AUTOPLAY —
  // the rAF drives the auto-dive.
  features: ["AUTOPLAY", "FLAT"],
  theme: { accent: ACCENT },
  mount: mountAbismo,
};

// Backtick drops a fish-prompt console over the dive: built-ins (transport /
// set / get / describe) plus auto / surface / palette.
export const abismoLens = withConsole(abismoLensBase, {
  description: "an infinite scroll-driven dive into the Mandelbrot set",
});
