/* makeFrameProfiler — the dev-only sink that turns the loop core's raw
 * `profile` samples (`raf-loop-core.ts`, `FrameProfileSample`) into an actual
 * instrument: per-phase worst-since-mount + p95 over a rolling window, and a
 * one-shot `console.warn` the first time a phase blows the frame budget.
 *
 * Why this exists (the S111 grid stutter): a heavy `stroke()` of ~13,728 hexes
 * ran *inside* `render`, taking 528ms. The only thing that caught it was
 * Chrome's `[Violation] rAF handler took 528ms` — Firefox stayed silent, and
 * the existing `reportFps` sink couldn't help because it averages frames over
 * 500ms, so a single spike is smeared into the mean and disappears. This sink
 * is cross-browser, attributes the cost to a phase (`tick` vs `render`) and a
 * caller-supplied label (the substrate/lens — Tier 2 attribution), and fires
 * once instead of spamming. Finer-than-phase spans inside `render` (Tier 3) are
 * deliberately NOT here — frozen until a second real-world issue needs them.
 *
 * Policy lives here, not in the loop core: the core only emits timings; this
 * decides budget, window, warn-once latching, and where it surfaces. Pure
 * except `frameProfilerFromEnv`, which reads the runtime gate.
 */

import type { FrameProfileSample } from "./raf-loop-core";

/** The phases a profiler reports on, in display order. `frame` is the rollup. */
const PHASES = ["tick", "render", "frame"] as const;
type Phase = FrameProfileSample["phase"];
/** Warn only on the attributable work phases; `frame` is the sum, so warning on
 *  it too would double-report the same spike. */
const WARN_PHASES: ReadonlySet<Phase> = new Set<Phase>(["tick", "render"]);

const DEFAULT_BUDGET_MS = 16; // ~one 60Hz frame
const DEFAULT_WINDOW = 120; // ~2s of frames at 60Hz

export type FrameProfilerOptions = {
  /** Tier-2 attribution — which substrate/lens this loop drives. Shown in the
   *  warning so the console says *what* janked, not just that something did. */
  label?: string;
  /** Per-phase warn threshold in ms. Default 16 (one 60Hz frame). */
  budgetMs?: number;
  /** Rolling window length (frames) for the p95. Default 120. */
  windowFrames?: number;
  /** Where the one-shot over-budget warning goes. Default `console.warn`. */
  warn?: (message: string) => void;
};

export type PhaseStat = {
  /** Max ms seen for this phase since mount (the one-shot "slowest phase"). */
  worst: number;
  /** 95th-percentile ms over the rolling window (steady-cost signal). */
  p95: number;
  /** Samples seen for this phase. */
  count: number;
};

export type FrameProfiler = {
  /** Pass as `attachRafLoopCore({ profile })`. */
  profile: (sample: FrameProfileSample) => void;
  /** Current rolling stats per phase — for a dev HUD or a manual console dump. */
  stats: () => Record<Phase, PhaseStat>;
};

type PhaseState = {
  worst: number;
  count: number;
  ring: number[]; // last `windowFrames` samples, oldest-first (wraps via `head`)
  head: number;
  warned: boolean; // latched: warn at most once per phase
};

function p95Of(ring: number[]): number {
  if (ring.length === 0) return 0;
  const sorted = [...ring].sort((a, b) => a - b);
  // Nearest-rank: index of the 95th percentile, clamped to the last element.
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

export function makeFrameProfiler(opts: FrameProfilerOptions = {}): FrameProfiler {
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const window = Math.max(1, opts.windowFrames ?? DEFAULT_WINDOW);
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const tag = opts.label ? `${opts.label} ` : "";

  const states: Record<Phase, PhaseState> = {
    tick: { worst: 0, count: 0, ring: [], head: 0, warned: false },
    render: { worst: 0, count: 0, ring: [], head: 0, warned: false },
    frame: { worst: 0, count: 0, ring: [], head: 0, warned: false },
  };

  return {
    profile(sample) {
      const s = states[sample.phase];
      const ms = sample.ms;
      s.count += 1;
      if (ms > s.worst) s.worst = ms;
      if (s.ring.length < window) s.ring.push(ms);
      else {
        s.ring[s.head] = ms;
        s.head = (s.head + 1) % window;
      }
      if (!s.warned && ms > budget && WARN_PHASES.has(sample.phase)) {
        s.warned = true;
        warn(
          `[coso:profile] ${tag}${sample.phase} phase took ${ms.toFixed(1)}ms ` +
            `(budget ${budget}ms) — slowest since mount; this won't warn again`,
        );
      }
    },
    stats() {
      const out = {} as Record<Phase, PhaseStat>;
      for (const phase of PHASES) {
        const s = states[phase];
        out[phase] = { worst: s.worst, p95: p95Of(s.ring), count: s.count };
      }
      return out;
    },
  };
}

/** Build a profiler from the runtime gate, or `undefined` when profiling is off
 *  (so the caller passes nothing and the loop stays zero-overhead). Enabled by:
 *    - `?profile` in the URL — optionally `?profile=8` to set the budget (ms);
 *    - `globalThis.__COSO_PROFILE__` truthy — a number sets the budget.
 *  Off by default ⇒ production embeds never pay for it unless explicitly asked.
 *  SSR/headless-safe (no `location`/`globalThis` ⇒ off). */
export function frameProfilerFromEnv(label?: string): FrameProfiler | undefined {
  let budget: number | undefined;
  let enabled = false;

  const g = (globalThis as { __COSO_PROFILE__?: unknown }).__COSO_PROFILE__;
  if (g !== undefined && g !== false) {
    enabled = true;
    if (typeof g === "number") budget = g;
  }

  if (typeof location !== "undefined" && typeof location.search === "string") {
    const params = new URLSearchParams(location.search);
    if (params.has("profile")) {
      enabled = true;
      const raw = params.get("profile");
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) budget = n;
    }
  }

  if (!enabled) return undefined;
  return makeFrameProfiler({
    ...(label !== undefined ? { label } : {}),
    ...(budget !== undefined ? { budgetMs: budget } : {}),
  });
}
