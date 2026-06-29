/* requestAnimationFrame driver (host-agnostic core) — one render per frame,
 * with optional ticking driven by a real-time accumulator. Extracted from
 * ticking lenses (e.g. conway) and render-only lenses;
 * both shapes collapse to one helper by making `tick` optional.
 *
 * This is the store-free core: every host coupling is an injected callback, so
 * the same loop drives the React chrome (which injects `useStore` reads for the
 * fps cap + readout — see `@/app/lib/lens-host/raf-loop`) and the react-less
 * embed (which injects nothing).
 *
 * When `tick` is provided, each (non-skipped) frame:
 *   1. If `isPlaying()` AND the window is focused, advance the accumulator by
 *      `speedMult() * TARGET_BASELINE_HZ * dt` (dt in seconds since the last
 *      executed frame, clamped) and drain it by calling `tick()` while ≥ 1.
 *   2. Call `render()` once.
 * When `tick` is undefined, each frame just calls `render()`.
 *
 * **Tick rate is decoupled from render rate.** `speedMult() === 1` means
 * "1× = `TARGET_BASELINE_HZ` ticks/sec" regardless of monitor refresh or the
 * fps cap — speeds are real-time semantics, not per-frame ratios. The first
 * frame after a tab-refocus burst is clamped to `MAX_FRAME_DT_MS`.
 *
 * **Pause-on-unfocus.** By default ticks gate on window focus (blur/focus +
 * visibilitychange); render keeps running so resize/redraw stays responsive.
 * A host with a different activity model injects `isActive` — e.g. an embed
 * gates on viewport visibility instead of window focus, since an iframe is
 * almost never "focused" (`document.hasFocus()` is false until clicked, which
 * would otherwise freeze a self-playing embed on load). When `isActive` is
 * supplied the loop registers no focus listeners and just polls it — AND it
 * gates `render` on it too (not just ticks): a host that knows it's off-screen
 * shouldn't redraw, so a heavy render (e.g. a many-particle swarm) costs nothing
 * while the embed is scrolled out of a feed. The built-in focus gate keeps
 * rendering while unfocused (so resize stays responsive on the app chrome).
 *
 * `fpsCap()` gates how often we *render* (0 = uncapped); `reportFps` receives a
 * four-up `FpsStats` (instant / averageTotal / average10s / min10s) sampled
 * every ~500ms (and zeroed on stop). Both default to inert, so a host that
 * doesn't care omits them. The stats accumulator is host-agnostic
 * (`./fps-stats`) so the chrome and the export embeds read identical numbers.
 */

import { makeFpsStats, ZERO_FPS, type FpsStats } from "./fps-stats";

const FPS_SAMPLE_MS = 500;
// Tolerance below the cap interval so a 60Hz cap on a 60Hz monitor doesn't
// alternate between firing and skipping due to rAF jitter (~0.1–0.3ms).
const CAP_JITTER_TOLERANCE_MS = 0.5;
// Tick-rate baseline — `speedMult === 1` advances this many ticks per real-time
// second. 60Hz is the baseline puzzle configs + feel were tuned against.
const TARGET_BASELINE_HZ = 60;
// Frame-dt clamp. Tab refocus / debugger pause / OS sleep can hand us a huge
// dt; 100ms = 6 ticks at 1× — bounded skip, no catchup spiral.
const MAX_FRAME_DT_MS = 100;

export type RafLoopCoreOpts = {
  /** Called once per frame, after any ticks. */
  render: () => void;
  /** Called by the accumulator while playing. Optional — when omitted, the
   * loop is render-only. */
  tick?: () => void;
  /** Gate for the ticking branch. Defaults to `() => false` so leaving `tick`
   * set without `isPlaying` is the safe (paused) state. */
  isPlaying?: () => boolean;
  /** Tick-rate multiplier. `1` = `TARGET_BASELINE_HZ` ticks/sec. Default 1. */
  speedMult?: () => number;
  /** Extra gate on ticking. When omitted, ticking pauses while the window is
   * unfocused or the tab is hidden (the app-chrome default, with built-in
   * focus/visibility listeners). When supplied it replaces that gate entirely
   * and the loop owns no focus listeners — the host's predicate is the sole
   * activity signal (polled each frame). */
  isActive?: () => boolean;
  /** Render-rate ceiling in fps; 0 = uncapped (sync to monitor). Default 0. */
  fpsCap?: () => number;
  /** FPS readout sink — a four-up `FpsStats` sampled ~every 500ms (and zeroed
   * on stop). Default inert. */
  reportFps?: (stats: FpsStats) => void;
  /** Dev-only per-phase frame-cost sink. When omitted the loop adds zero
   * overhead (no extra `performance.now()` calls). When set, each frame emits a
   * `tick`/`render`/`frame` timing — the cross-browser signal `reportFps` can't
   * give: a single 528ms spike is smeared into the 500ms fps mean and vanishes,
   * but lands here as one `render` sample. Pair with `makeFrameProfiler` (a
   * sink that warns over budget + tracks worst/p95). */
  profile?: (sample: FrameProfileSample) => void;
};

export type RafLoopHandle = {
  /** Halt the loop on the next frame boundary. Idempotent. */
  stop: () => void;
};

/** One per-frame timing emitted to an injected `profile` sink. `tick` is the
 *  whole accumulator-drain (all ticks this frame summed), `render` the single
 *  render call, `frame` the whole handler. Phases that didn't run that frame
 *  (e.g. `tick` while paused, `render` while an inactive embed skips it) emit
 *  nothing. The sample carries no lens identity — that's a constant the caller's
 *  sink closes over (keeps the core host-agnostic). */
export type FrameProfileSample = {
  phase: "tick" | "render" | "frame";
  ms: number;
};

function computeFocused(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus() && !document.hidden;
}

export function attachRafLoopCore(opts: RafLoopCoreOpts): RafLoopHandle {
  const { render, tick } = opts;
  const isPlaying = opts.isPlaying ?? (() => false);
  const speedMult = opts.speedMult ?? (() => 1);
  const fpsCap = opts.fpsCap ?? (() => 0);
  const reportFps = opts.reportFps ?? (() => {});
  // Undefined ⇒ zero added cost (the `performance.now()` brackets below are
  // skipped entirely). Captured once so the hot path branches on a local.
  const profile = opts.profile;

  let stopped = false;
  let tick_accumulator = 0;
  const fpsStats = makeFpsStats();
  let last_sample_time = performance.now();
  let last_frame_time = performance.now();

  // Built-in focus gate (the app default). When the host injects `isActive`,
  // it owns the activity signal and these listeners are never registered.
  const owns_focus_gate = opts.isActive === undefined;
  let is_focused = computeFocused();
  const onFocusChange = (): void => {
    is_focused = computeFocused();
  };
  if (owns_focus_gate) {
    window.addEventListener("focus", onFocusChange);
    window.addEventListener("blur", onFocusChange);
    document.addEventListener("visibilitychange", onFocusChange);
  }
  const isActive = opts.isActive ?? (() => is_focused);

  function frame(): void {
    if (stopped) return;
    // Schedule next first so a skipped frame still polls forward.
    requestAnimationFrame(frame);

    const now = performance.now();
    const cap = fpsCap();
    if (cap > 0 && now - last_frame_time < 1000 / cap - CAP_JITTER_TOLERANCE_MS) {
      return;
    }
    const dt_ms = Math.min(now - last_frame_time, MAX_FRAME_DT_MS);
    last_frame_time = now;
    // Only executed (non-cap-skipped) frames reach here — feed the rate stats.
    fpsStats.sample(dt_ms);

    const active = isActive();
    if (tick !== undefined && active && isPlaying()) {
      const t0 = profile ? performance.now() : 0;
      tick_accumulator += speedMult() * TARGET_BASELINE_HZ * (dt_ms / 1000);
      while (tick_accumulator >= 1 && active && isPlaying() && !stopped) {
        tick();
        tick_accumulator -= 1;
      }
      if (profile) profile({ phase: "tick", ms: performance.now() - t0 });
    }
    // Render: the app default (built-in focus gate) keeps rendering while
    // unfocused so resize/redraw stays responsive. A host with an INJECTED
    // activity model (an embed gating on viewport visibility) skips render while
    // inactive too — no point redrawing an off-screen embed, which is the real
    // CPU win for a heavy render (a self-playing embed scrolled out of a feed).
    if (active || owns_focus_gate) {
      const t0 = profile ? performance.now() : 0;
      render();
      if (profile) profile({ phase: "render", ms: performance.now() - t0 });
    }
    if (profile) profile({ phase: "frame", ms: performance.now() - now });

    if (now - last_sample_time >= FPS_SAMPLE_MS) {
      reportFps(fpsStats.read());
      last_sample_time = now;
    }
  }
  requestAnimationFrame(frame);

  return {
    stop: () => {
      stopped = true;
      if (owns_focus_gate) {
        window.removeEventListener("focus", onFocusChange);
        window.removeEventListener("blur", onFocusChange);
        document.removeEventListener("visibilitychange", onFocusChange);
      }
      reportFps(ZERO_FPS);
    },
  };
}
