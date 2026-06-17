/* Re-render on head changes — subscribe to the store and call `render`
 * whenever `playheadTick` or `historyVersion` shifts. Used by lenses
 * without an rAF loop (event-driven render), e.g. a turn-based board lens.
 *
 * Lenses with an rAF loop don't need this — their frame() already reads
 * history.substrate.read every frame.
 */

import { useStore } from "@/app/store";

export function subscribeHead(render: () => void): () => void {
  return useStore.subscribe((s, prev) => {
    if (
      s.playheadTick !== prev.playheadTick ||
      s.historyVersion !== prev.historyVersion
    ) {
      render();
    }
  });
}
