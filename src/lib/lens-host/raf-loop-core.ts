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
 * supplied the loop registers no focus listeners and just polls it.
 *
 * `fpsCap()` gates how often we *render* (0 = uncapped); `reportFps` receives a
 * rolling readout sampled every ~500ms (and 0 on stop). Both default to inert,
 * so a host that doesn't care omits them.
 */

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
  /** Rolling FPS readout sink, sampled ~every 500ms (and 0 on stop). Default
   * inert. */
  reportFps?: (fps: number) => void;
};

export type RafLoopHandle = {
  /** Halt the loop on the next frame boundary. Idempotent. */
  stop: () => void;
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

  let stopped = false;
  let tick_accumulator = 0;
  let frames_since_sample = 0;
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

    if (tick !== undefined && isActive() && isPlaying()) {
      tick_accumulator += speedMult() * TARGET_BASELINE_HZ * (dt_ms / 1000);
      while (tick_accumulator >= 1 && isActive() && isPlaying() && !stopped) {
        tick();
        tick_accumulator -= 1;
      }
    }
    render();

    frames_since_sample += 1;
    const elapsed = now - last_sample_time;
    if (elapsed >= FPS_SAMPLE_MS) {
      reportFps((frames_since_sample * 1000) / elapsed);
      frames_since_sample = 0;
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
      reportFps(0);
    },
  };
}
