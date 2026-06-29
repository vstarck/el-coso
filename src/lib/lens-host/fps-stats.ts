/* makeFpsStats — a pure, host-agnostic frame-rate accumulator. Fed one frame
 * delta at a time by the rAF loop core; reports four readings:
 *
 *   • instant      — rolling mean over the last ~500ms (the live number)
 *   • averageTotal — mean fps since the loop started (this mount's whole run)
 *   • average10s   — mean fps over the last 10 seconds
 *   • min10s       — the WORST single-frame fps in the last 10s (catches hitches
 *                    a mean smears away)
 *
 * It lives in the shared lens-host layer (not the chrome) on purpose: the same
 * loop drives the React app AND the react-less export embeds, so both read the
 * same numbers — letting you measure an embed's performance in place on a real
 * page. No DOM, no store, fully unit-testable.
 *
 * Fed the loop's already-clamped frame delta, so an OS-sleep / tab-away gap
 * shows as the clamp floor for one frame (then ages out of the window) rather
 * than a bogus sub-1fps reading.
 */

export type FpsStats = {
  instant: number;
  averageTotal: number;
  average10s: number;
  min10s: number;
};

export const ZERO_FPS: FpsStats = {
  instant: 0,
  averageTotal: 0,
  average10s: 0,
  min10s: 0,
};

export type FpsStatsAccumulator = {
  /** Record one executed frame's duration (ms). */
  sample: (dtMs: number) => void;
  /** Current four-up reading. Cheap to call (single pass over the live window). */
  read: () => FpsStats;
  /** Forget everything — a fresh run (e.g. lens swap remounts the loop). */
  reset: () => void;
};

const WINDOW_MS = 10_000; // the "10s" window
const INSTANT_MS = 500; // the live rolling readout
// Compact the ring once the consumed prefix grows past this (amortized O(1)).
const COMPACT_AT = 4096;

type Frame = { t: number; dt: number }; // t = virtual clock (ms) at frame end

export function makeFpsStats(): FpsStatsAccumulator {
  let frames: Frame[] = [];
  let head = 0; // index of the oldest still-live frame
  let clock = 0; // virtual ms elapsed since reset
  let totalFrames = 0;
  let totalMs = 0;

  function prune(): void {
    while (head < frames.length && clock - frames[head]!.t > WINDOW_MS) head++;
    if (head > COMPACT_AT) {
      frames = frames.slice(head);
      head = 0;
    }
  }

  return {
    sample(dtMs: number): void {
      if (!(dtMs > 0)) return; // guard NaN / zero / negative
      clock += dtMs;
      totalFrames += 1;
      totalMs += dtMs;
      frames.push({ t: clock, dt: dtMs });
      prune();
    },

    read(): FpsStats {
      let winCount = 0;
      let winMs = 0;
      let maxDt = 0;
      let instCount = 0;
      let instMs = 0;
      for (let i = head; i < frames.length; i++) {
        const f = frames[i]!;
        winCount += 1;
        winMs += f.dt;
        if (f.dt > maxDt) maxDt = f.dt;
        if (clock - f.t <= INSTANT_MS) {
          instCount += 1;
          instMs += f.dt;
        }
      }
      return {
        instant: instMs > 0 ? (instCount * 1000) / instMs : 0,
        averageTotal: totalMs > 0 ? (totalFrames * 1000) / totalMs : 0,
        average10s: winMs > 0 ? (winCount * 1000) / winMs : 0,
        min10s: maxDt > 0 ? 1000 / maxDt : 0,
      };
    },

    reset(): void {
      frames = [];
      head = 0;
      clock = 0;
      totalFrames = 0;
      totalMs = 0;
    },
  };
}
