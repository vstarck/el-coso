/* Blockoide deck lens — the orchestrating composite, the substrate's single
 * registered lens. It owns the chrome-less HUD (title / altimeter / stats /
 * controls), a swappable center view, and the sole DeckController.
 *
 * This file is the thin full-app wrapper: it adapts the store-free
 * `mountDeck` core to the chrome by wiring the deck's host hooks to the
 * injected `LensHost` ("ask, don't read" — no `@/app/store` import) and
 * supplying the chrome-facing API surface (commitGlyph, outcomeFor,
 * hudMetrics, pause/resume/step). The embed host calls `mountDeck` directly
 * with its own hooks — it never imports this file, keeping the bundle
 * react-less and store-less.
 */

import type { Lens, LensMountArgs, MountedLens } from "@/lenses/types";
import type {
  BlockoideCommitPayload,
  BlockoideConfig,
  BlockoideInputs,
  SubstrateState,
} from "../engine";
import { PIECE_NAMES } from "../engine";
import { CADENCE, SPEEDS } from "./controller";
import {
  commitGlyph,
  DECK_TUNABLES,
  hudMetricsFor,
  mountDeck,
  outcomeFor,
  type DeckHostHooks,
} from "./deck-core";
// The full app injects the deck + view CSS globally (Vite). The embed host
// imports these as `?inline` strings into a shadow root instead — so the CSS
// delivery is decoupled from the store-free core.
import "./deck.css";
import "./style.css";

const ACCENT = "#41bf00";

function mountDeckLens(
  args: LensMountArgs<
    SubstrateState,
    BlockoideConfig,
    BlockoideInputs,
    BlockoideCommitPayload
  >,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;

  const hooks: DeckHostHooks = {
    isPlaying: () => host.isPlaying(),
    setPlaying: (p) => host.setPlaying(p),
    onPlayhead: (t) => host.setPlayheadTick(t),
    onHistoryChanged: () => host.bumpHistoryVersion(),
    // The chrome's OutcomeDialog already handles win/lose here.
    ownsOutcomeOverlay: false,
  };

  const deck = mountDeck(container, history, hooks);

  return {
    unmount: deck.unmount,
    renderFrom: deck.renderFrom,
    tick: deck.tick,
    speedMult: deck.speedMult,
    snapshot: deck.snapshot,
    commitGlyph,
    outcomeFor,
    hudMetrics: hudMetricsFor(history),
    pause: () => host.setPlaying(false),
    resume: () => host.setPlaying(true),
    step: () => {
      host.setPlaying(false);
      deck.tick();
    },
    setSpeed: deck.setSpeed,
    getTunable: deck.getTunable,
    setTunable: deck.setTunable,
    subscribeTunables: deck.subscribeTunables,
  };
}

export const blockoideDeckLens: Lens<
  SubstrateState,
  BlockoideConfig,
  BlockoideInputs,
  BlockoideCommitPayload
> = {
  id: "blockoide-deck",
  name: "Deck",
  tunables: DECK_TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  // The deck is a DOM composite (its center view may be ascii or canvas2d);
  // BOUNDED so the chrome centers its fixed 640px box.
  target_kind: "dom",
  features: ["AUTOPLAY", "BOUNDED"],
  theme: { accent: ACCENT },
  mount: mountDeckLens,
};

export { PIECE_NAMES };
