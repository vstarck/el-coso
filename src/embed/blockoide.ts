/* Embeddable Blockoide — the react-less, store-less host.
 *
 * This is the entry the standalone bundle is built from. It owns nothing the
 * full app owns: no React, no Zustand store, no chrome. It creates a history,
 * mounts the deck core (`mountDeck`) with embed hooks, and runs a tiny
 * real-time tick loop. Everything else — the HUD, the views, the transport,
 * the overlays — comes from the deck, which is shared verbatim with the full
 * app.
 *
 * Deliberately imports from the ENGINE barrel + the deck CORE, never the
 * substrate barrel (which pulls the full-app lens wrapper and the store).
 */

import { createHistory } from "@/history";
import {
  blockoideBundle,
  blockoideBttfAdapter,
  parseLevel,
  KEYFRAME_PERIOD,
} from "@/substrates/blockoide/engine";
import { mountDeck, type DeckHostHooks } from "@/substrates/blockoide/lens/deck-core";
import type { TunableValue } from "@/lenses/types";
// The host-agnostic rAF driver — the same loop the React chrome runs, minus the
// store glue. The embed injects nothing (no fps cap, no fps readout).
import { attachRafLoopCore } from "@/lib/lens-host/raf-loop-core";
import { frameProfilerFromEnv } from "@/lib/lens-host/frame-profiler";
import sprint from "@/substrates/blockoide/puzzles/sprint.json";
// CSS as strings (no emitted .css file, no global injection) — injected into
// the embed's shadow root so the bundle is a single self-contained JS and
// can't leak styles into (or inherit them from) the host page.
import deckCss from "@/substrates/blockoide/lens/deck.css?inline";
import styleCss from "@/substrates/blockoide/lens/style.css?inline";

export type BlockoideEmbedOptions = {
  /** A puzzle JSON (the shape in `puzzles/*.json`). Defaults to "sprint". */
  puzzle?: unknown;
  /** RNG seed override; defaults to the puzzle's or 1. */
  seed?: number;
  /** Start running on mount. Defaults to true. */
  autoplay?: boolean;
  /**
   * Let the heuristic autopilot play on its own — the right default for a
   * feed-post demo. A human keypress hands control back. Defaults to true.
   */
  autopilot?: boolean;
  /**
   * Lens tunables to apply after mount, keyed by dotted path — e.g.
   * `{ theme: "matrix" }` for the shaft's ShaftTheme, or `{ tilt: 0.3 }`.
   * Forwarded to the active center view; unknown paths are ignored.
   */
  tunables?: Record<string, TunableValue>;
};

export type BlockoideEmbedHandle = {
  destroy(): void;
};

export function mountBlockoide(
  target: HTMLElement | string,
  opts: BlockoideEmbedOptions = {},
): BlockoideEmbedHandle {
  const el =
    typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`mountBlockoide: target not found (${String(target)})`);

  // Shadow root for two-way style isolation; CSS lives inside it. Falls back
  // to light DOM if the host element can't attach a shadow (rare).
  let mountPoint: HTMLElement;
  let shadow: ShadowRoot | null = null;
  try {
    shadow = el.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${deckCss}\n${styleCss}`;
    mountPoint = document.createElement("div");
    shadow.append(style, mountPoint);
  } catch {
    const style = document.createElement("style");
    style.textContent = `${deckCss}\n${styleCss}`;
    document.head.appendChild(style);
    mountPoint = el;
  }

  const config = parseLevel(opts.puzzle ?? sprint);
  const seed = opts.seed ?? (config as { rng_seed?: number }).rng_seed ?? 1;
  const history = createHistory({
    bundle: blockoideBundle,
    config,
    rng_seed: seed,
    adapter: blockoideBttfAdapter,
    keyframe_period: KEYFRAME_PERIOD,
  });

  // The embed owns play-state (its own flag); no store, no chrome callbacks.
  // ownsOutcomeOverlay defaults true — the deck draws its own win/lose card.
  let playing = opts.autoplay ?? true;
  const hooks: DeckHostHooks = {
    isPlaying: () => playing,
    setPlaying: (p) => {
      playing = p;
    },
  };
  const deck = mountDeck(mountPoint, history, hooks, {
    autopilot: opts.autopilot ?? true,
  });

  // Apply any setup-time tunables (e.g. a shaft theme) to the active view.
  for (const [path, value] of Object.entries(opts.tunables ?? {})) {
    deck.setTunable(path.split("."), value);
  }

  // Real-time loop — the shared host-agnostic driver. Tick gated on the
  // embed's own play flag + window focus; render runs every frame.
  const profiler = frameProfilerFromEnv("blockoide");
  const loop = attachRafLoopCore({
    render: () => deck.renderFrom(history.substrate.read),
    tick: deck.tick,
    isPlaying: () => playing,
    speedMult: deck.speedMult,
    ...(profiler ? { profile: profiler.profile } : {}),
  });

  return {
    destroy(): void {
      loop.stop();
      deck.unmount();
      shadow?.replaceChildren();
    },
  };
}
