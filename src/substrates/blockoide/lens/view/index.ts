/* Center-view registry — the swappable world views the deck composes.
 * Order is the swap order the deck's furniture cycles through.
 */

import type { LensTunable } from "@/lenses/types";
import type { CenterViewFactory, CenterViewId } from "./types";
import { makeShaftView, SHAFT_TUNABLES } from "./shaft";
import { makePitView, PIT_TUNABLES } from "./pit";
import { makeWellView, WELL_TUNABLES } from "./well";

export type { CenterView, CenterViewFactory, CenterViewId } from "./types";

// Static metadata only — the tunables are constant arrays (no view instance,
// so loading the registry never touches the DOM; the standalone-package load
// test depends on that).
export const CENTER_VIEWS: ReadonlyArray<{
  id: CenterViewId;
  label: string;
  make: CenterViewFactory;
  tunables: LensTunable[];
}> = [
  { id: "shaft", label: "Shaft", make: makeShaftView, tunables: SHAFT_TUNABLES },
  { id: "pit", label: "Pit", make: makePitView, tunables: PIT_TUNABLES },
  { id: "well", label: "Well", make: makeWellView, tunables: WELL_TUNABLES },
];

export function centerViewById(id: string) {
  return CENTER_VIEWS.find((v) => v.id === id) ?? CENTER_VIEWS[0]!;
}
