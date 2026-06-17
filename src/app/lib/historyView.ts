/* useHistoryView — the React hook binding the chrome's components to the
 * live `session.history` (spec §2). Memoized on the store's historyVersion;
 * the lens bumps historyVersion on each commit emission and on structural
 * changes (branch_from, truncate, set_active_branch). Tick-only advances
 * push playheadTick separately and do NOT invalidate the timeline tree's
 * structural memo.
 *
 * The pure builder (`buildView`) and the `HistoryView` type live in the
 * **session-free** `buildHistoryView.ts` — substrate lenses must import
 * them from there, never from here, or they close an import cycle through
 * `session` (see that file's header). This module is chrome-only: it reads
 * the global `session`, so importing it from a lens package is the bug the
 * split exists to prevent.
 */

import { useMemo } from "react";
import { session } from "../session";
import { useStore } from "../store";
import { buildView, type HistoryView } from "@/lib/buildHistoryView";

// Re-exported for the chrome components that already pull `useHistoryView`
// from here. Lenses must NOT use this re-export path — import from
// `buildHistoryView` directly.
export { buildView, type HistoryView };

export function useHistoryView(): HistoryView {
  const version = useStore((s) => s.historyVersion);
  return useMemo(
    () => buildView(session.history),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}
