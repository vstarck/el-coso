/* Store-backed LensHost — the React app's bridge.
 *
 * The mirror of the store-free `makeLensHost` (@/lib/lens-host/host): the
 * same `LensHost` interface, but every method delegates to the Zustand
 * store so the chrome's panels + timeline tree keep re-rendering exactly as
 * before the host seam existed. Lenses talk to this through
 * `LensMountArgs.host`; they no longer import `@/app/store` directly.
 */

import type { LensHost } from "@/lenses/types";
import { useStore } from "@/app/store";
import { subscribeHead } from "./subscribe-head";

export const storeLensHost: LensHost = {
  isPlaying: () => useStore.getState().playing,
  setPlaying: (playing) => useStore.getState().setPlaying(playing),
  togglePlaying: () => useStore.getState().togglePlaying(),
  getSpeedId: () => useStore.getState().speedId,
  setSpeedId: (id) => useStore.getState().setSpeedId(id),
  getPlayheadTick: () => useStore.getState().playheadTick,
  setPlayheadTick: (tick) => useStore.getState().setPlayheadTick(tick),
  getHistoryVersion: () => useStore.getState().historyVersion,
  bumpHistoryVersion: () => useStore.getState().bumpHistoryVersion(),
  subscribeHead,
};
