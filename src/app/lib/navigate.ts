/* Substrate navigation orchestration, shared by the toolbar picker and the
 * gallery modal. Wraps the session-tier swap (setSubstrate / setLens) with the
 * store-tier side effects a substrate switch needs: reset the speed to the new
 * lens's default, re-apply the substrate's chrome-panel defaults, and bump the
 * session so SubstrateHost re-mounts. Idempotent — a click on the current
 * selection is a no-op.
 */

import { chromePanelsFor, session, setLens, setSubstrate } from "@/app/session";
import { useStore } from "@/app/store";

export function selectSubstrate(
  substrateId: string,
  opts: { puzzle?: string; lens?: string } = {},
): void {
  // setSubstrate resets the lens to the substrate's default; a variant lens is
  // applied afterwards. Either may be a no-op (already selected) — only bail if
  // nothing changed at all.
  const substrateChanged = setSubstrate(substrateId, opts.puzzle);
  const lensChanged = opts.lens ? setLens(opts.lens) : false;
  if (!substrateChanged && !lensChanged) return;

  const store = useStore.getState();
  const speeds = session.active_lens.speeds;
  const speedId = speeds.find((s) => s.isDefault)?.id ?? speeds[0]?.id ?? "1x";
  store.setSpeedId(speedId);
  store.applyChromePanels(chromePanelsFor(session.active_substrate_id));
  store.bumpSession();
}
