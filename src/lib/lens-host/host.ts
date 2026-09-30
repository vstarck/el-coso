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
import { windowIsActive } from "./raf-loop-core";

export type MakeLensHostOptions = {
  /** Fired whenever play-state flips, so the host's rAF gate stays in sync
   *  with `isPlaying()` without polling. */
  onPlay?: (playing: boolean) => void;
  /** Initial speed preset id. Defaults to "turn" (the store's default). */
  speedId?: string;
  /** Start playing? Defaults to false; the host flips it true for AUTOPLAY
   *  lenses on mount, same as SubstrateHost. */
  playing?: boolean;
  /** The activity half of the motion gate — see `LensHost.isActive`. Defaults to
   *  the window-focus predicate, which is right for a BARE host in the top
   *  document and wrong for an embed in an iframe. `mountHost` therefore always
   *  supplies this, and supplies the very closure it hands the rAF loop, so the
   *  lens's answer and the loop's gate are one function. A caller building a
   *  host by hand for an iframe MUST pass its own. */
  isActive?: () => boolean;
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

  const isActive = opts.isActive ?? windowIsActive;

  return {
    isPlaying: () => playing,
    isActive,
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

/** Bind one activity predicate to BOTH of its readers: the `LensHost` the lens
 *  asks, and the gate the rAF loop ticks on.
 *
 *  ★ IT RETURNS A PAIR ON PURPOSE. The whole hazard this seam exists to close is
 *  the lens's answer drifting from the loop's gate — two copies of one rule,
 *  with nothing to notice when they disagree (a soundtrack playing over a frozen
 *  picture is silent, in every sense). Handing back `{ host, gate }` from a
 *  single call makes them the SAME function object, so divergence needs someone
 *  to stop using `gate`, which is a visible act rather than a quiet drift.
 *  `host.isActive === gate` is gateable in `node`; the call site that feeds the
 *  loop is not, and that one line is the residue.
 *
 *  ⚠ OVERRIDES `base.isActive`. A caller-supplied host cannot know it is about
 *  to be embedded — `makeLensHost` defaults to window focus, which is wrong in
 *  an iframe — so the mounting host decides and this silently wins. */
export function activityGate(
  base: LensHost,
  isActive: () => boolean,
): { host: LensHost; gate: () => boolean } {
  return { host: { ...base, isActive }, gate: isActive };
}
