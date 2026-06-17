/* Store-free LensHost — the embed/bare host's transport + head-change
 * observable, with no React and no Zustand.
 *
 * This is the whole runtime a chrome-less host needs to satisfy the lens
 * contract's `LensHost` (src/lenses/types.ts). The React app has a mirror
 * implementation that delegates each method to its Zustand store so the
 * chrome's panels + timeline keep re-rendering; here there is no chrome, so
 * the timeline members store a value but drive nothing beyond
 * `subscribeHead` (which render-only lenses use to repaint).
 *
 * Why not just reuse zustand here? Because the only thing the lenses use a
 * store for is `getState()` + `subscribe()` — a ~40-line observable. The
 * value zustand adds (the `useStore(selector)` React hook) is consumed only
 * by chrome, never by a lens. So the embed pays nothing for it.
 */

import type { LensHost } from "@/lenses/types";

export type MakeLensHostOptions = {
  /** Fired whenever play-state flips, so the host's rAF gate stays in sync
   *  with `isPlaying()` without polling. */
  onPlay?: (playing: boolean) => void;
  /** Initial speed preset id. Defaults to "turn" (the store's default). */
  speedId?: string;
  /** Start playing? Defaults to false; the host flips it true for AUTOPLAY
   *  lenses on mount, same as SubstrateHost. */
  playing?: boolean;
};

export function makeLensHost(opts: MakeLensHostOptions = {}): LensHost {
  let playing = opts.playing ?? false;
  let speedId = opts.speedId ?? "turn";
  let playheadTick = 0;
  let historyVersion = 0;
  const heads = new Set<() => void>();
  const fireHead = () => {
    for (const listener of heads) listener();
  };
  const setPlaying = (next: boolean) => {
    if (next === playing) return;
    playing = next;
    opts.onPlay?.(playing);
  };

  return {
    isPlaying: () => playing,
    setPlaying,
    togglePlaying: () => setPlaying(!playing),
    getSpeedId: () => speedId,
    setSpeedId: (id) => {
      speedId = id;
    },
    getPlayheadTick: () => playheadTick,
    setPlayheadTick: (tick) => {
      if (tick === playheadTick) return;
      playheadTick = tick;
      fireHead();
    },
    getHistoryVersion: () => historyVersion,
    bumpHistoryVersion: () => {
      historyVersion += 1;
      fireHead();
    },
    subscribeHead: (listener) => {
      heads.add(listener);
      return () => heads.delete(listener);
    },
  };
}
