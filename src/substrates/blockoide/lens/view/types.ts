/* Center-view contract — the pure render half of a Blockoide world view.
 *
 * A view receives only `config` (read-only well geometry) at construction
 * and `state` once per frame via `renderFrom`. It NEVER sees `history`,
 * input, or the tick loop — those belong to the deck's controller. This is
 * the "clear API resolution" of the orchestrating-lens design: a view's
 * shape makes it incapable of driving time; it can only draw.
 *
 * The deck (the composing lens) mounts one view into its center slot,
 * aggregates the active view's tunables, and swaps views on demand while
 * the substrate (history) is left untouched.
 */

import type { LensTunable, TunableValue } from "@/lenses/types";
import type { BlockoideConfig, SubstrateState } from "../../engine";

export type CenterView = {
  // Pure draw against arbitrary state — no time advance, no mutation.
  renderFrom(state: SubstrateState): void;
  unmount(): void;
  // The view's own tunables (perspective / glyph set / tilt / …). The deck
  // exposes these to the chrome by forwarding to the active view.
  readonly tunables: LensTunable[];
  getTunable(path: string[]): TunableValue | undefined;
  setTunable(path: string[], value: TunableValue): void;
  subscribeTunables(listener: () => void): () => void;
  // Pixel-surface views (the canvas Pit) expose their canvas for snapshots;
  // ASCII/DOM views omit it.
  snapshot?(): HTMLCanvasElement | null;
};

export type CenterViewFactory = (
  slot: HTMLElement,
  config: BlockoideConfig,
) => CenterView;

export type CenterViewId = "shaft" | "pit" | "well";
