/* mountHost — the store-free, React-free twin of the app's SubstrateHost.
 *
 * Given a DOM container, a lens, and a history, it does what SubstrateHost
 * does minus the chrome: build the feature-appropriate layout frames, mount
 * the lens tree (`mountLensTree`), run a single rAF loop (`attachRafLoopCore`),
 * and own play-state through a `LensHost` (`makeLensHost`). No store, no
 * scenes, no snapshot-download, no panel insets — the surfaces a chrome-less
 * embed has no use for.
 *
 * This is the host the export/embed pipeline builds on: one of these per
 * mounted substrate, fed a config the pipeline bakes in (puzzle/lens/seed/
 * speed/tunables are applied by the caller via the returned `host` + `tree`).
 */

import {
  chromeAppliesPerspective,
  hasFeature,
  type Lens,
  type LensHost,
  type ReadonlyState,
  type RenderSize,
  type ViewportInset,
} from "@/lenses/types";
import type { History, TickedState } from "@/history";
import { attachRafLoopCore } from "./raf-loop-core";
import { type FrameProfiler, frameProfilerFromEnv } from "./frame-profiler";
import { fpsHudEnabledFromEnv, makeFpsHud, type FpsHud } from "./fps-hud";
import type { FpsStats } from "./fps-stats";
import { activityGate, makeLensHost } from "./host";
import { mountLensTree, type LensTree } from "./mount-tree";

// Matches the app's SubstrateHost perspective feel (it has no chrome to
// dodge, so the numbers are the only shared bit of that layout).
const PERSPECTIVE_PX = 2400;
const ROT_X_DEG = 8;
const ROT_Z_DEG = 0;
// Uniform breathing room a SAFE_AREA lens's in-canvas HUD should keep. The
// chrome derives this from panel occlusion; chrome-less, it's just padding
// (the app's layout.PAD).
const PAD = 16;

/** CSS `touch-action` values relevant to an interactive canvas embed. `none`
 *  fully captures touch (any-direction brush/drag works, but the page can't
 *  scroll over the embed); `pan-y` lets vertical page-scroll pass through while
 *  capturing horizontal drags (the good-citizen feed default); `manipulation`
 *  keeps scroll + pinch but kills the 300ms double-tap delay. Omit to leave the
 *  browser default (`auto`). */
export type TouchAction =
  | "auto"
  | "none"
  | "pan-x"
  | "pan-y"
  | "pan-x pan-y"
  | "manipulation";

export type MountHostOptions<State extends TickedState> = {
  /** Inject a host (e.g. one wired to a transport UI). Defaults to a fresh
   *  store-free `makeLensHost`. */
  host?: ReturnType<typeof makeLensHost>;
  /** `touch-action` for the host frame — a deployment policy, set by the embed
   *  (the app chrome never scrolls, so it doesn't need this). Applied to a
   *  canvas ancestor, so it constrains the gesture whatever the lens paints
   *  into. Omit ⇒ browser default. See {@link TouchAction}. */
  touchAction?: TouchAction;
  /** The substrate's fixed render envelope (`meta.renderSize`), if any. When
   *  present the whole lens tree renders inside one centered box of this size
   *  rather than full-bleed. */
  renderSize?: RenderSize | undefined;
  /** Start an AUTOPLAY lens running on mount (the app's behavior). Default
   *  true. */
  autoStartIfAutoplay?: boolean;
  /** Optional FPS-stats sink (four-up instant/avg/10s/min, sampled ~2Hz). The
   *  built-in `?fps` HUD is wired in addition to this, so an exported embed
   *  shows the counter in-place without the consumer doing anything. */
  reportFps?: (stats: FpsStats) => void;
  /** Label for the dev frame-profiler (the substrate/lens id), surfaced in
   *  over-budget warnings. The profiler is auto-wired from the runtime gate
   *  (`?profile` / `__COSO_PROFILE__`) and is off — zero loop overhead — unless
   *  that gate is set, so every exported embed gets it for free without paying
   *  for it in production. Pass `profiler` to override the auto-wiring. */
  profileLabel?: string;
  /** Pre-built profiler, bypassing the env gate (e.g. to feed a dev HUD). When
   *  omitted the host builds one from the runtime gate using `profileLabel`. */
  profiler?: FrameProfiler;
};

export type MountedHost<State extends TickedState> = {
  host: ReturnType<typeof makeLensHost>;
  tree: LensTree<State>;
  unmount(): void;
};

// Build the outer (children mount as siblings) + root_frame (the root lens
// mounts) pair inside `container`, styled per the lens's layout features —
// the vanilla-DOM equivalent of SubstrateHost's render() branches.
function buildFrames(
  container: HTMLElement,
  lens: { features?: Parameters<typeof hasFeature>[0]["features"]; target_kind: Parameters<typeof chromeAppliesPerspective>[0]["target_kind"] },
  renderSize: RenderSize | undefined,
): { outer: HTMLElement; root_frame: HTMLElement; cleanup: () => void } {
  // The container hosts an absolutely-positioned outer; make it a
  // positioning context without disturbing the caller's own sizing.
  const prev_position = container.style.position;
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  const outer = document.createElement("div");

  /* ★ `cleanup` is the SINGLE OWNER of undoing everything this function did to the
   * container — the removal as well as the style restore — and it closes over the node
   * that is actually the container's child.
   *
   * It did not use to. The caller removed the node instead, via
   * `if (outer.parentNode === container) container.removeChild(outer)` — but the
   * `renderSize` branch below appends `outer` and then returns the ENVELOPE under the
   * same name, one level down. So on that branch the caller's condition was
   * UNREACHABLE and nothing was ever removed: measured at two orphaned divs per
   * mount/destroy cycle, monotonic, on all 16 substrates that declare `meta.renderSize`
   * (a control substrate with no `renderSize` was clean, isolating it to that branch).
   *
   * The defect was in the NAME, not the logic: one identifier meant "the container's
   * child" in two branches and "a grandchild" in the third. Whoever owns the append
   * owns the remove. */
  const cleanup = () => {
    if (outer.parentNode === container) container.removeChild(outer);
    container.style.position = prev_position;
  };
  outer.style.position = "absolute";
  outer.style.inset = "0";
  outer.style.isolation = "isolate";

  // renderSize: one centered fixed box; outer === root_frame (HUD scoped
  // inside the envelope alongside the world, like SubstrateHost's renderSize
  // branch).
  if (renderSize) {
    outer.style.display = "flex";
    outer.style.alignItems = "center";
    outer.style.justifyContent = "center";
    const envelope = document.createElement("div");
    envelope.style.position = "relative";
    envelope.style.overflow = "hidden";
    envelope.style.width = `${renderSize.width}px`;
    envelope.style.height = `${renderSize.height}px`;
    envelope.setAttribute("aria-label", "substrate");
    outer.appendChild(envelope);
    container.appendChild(outer);
    return { outer: envelope, root_frame: envelope, cleanup };
  }

  container.appendChild(outer);

  // BOUNDED: root sizes its own element, anchored top-left. The host page (or
  // iframe) owns placement, so we don't center inside the full-bleed wrapper —
  // centering against a tall container would push the content to the middle and
  // leave dead space below it (the embed-in-a-tall-iframe case). Children (HUD
  // overlays) stay full-viewport as siblings of this wrapper.
  if (hasFeature(lens, "BOUNDED")) {
    const center = document.createElement("div");
    center.style.position = "absolute";
    center.style.inset = "0";
    center.style.pointerEvents = "none";
    const root_frame = document.createElement("div");
    root_frame.style.position = "relative";
    root_frame.style.pointerEvents = "auto";
    root_frame.setAttribute("aria-label", "substrate");
    center.appendChild(root_frame);
    outer.appendChild(center);
    return { outer, root_frame, cleanup };
  }

  // Full-bleed root. Pixel-surface lenses (no FLAT) get the perspective tilt.
  const root_frame = document.createElement("div");
  root_frame.style.position = "absolute";
  root_frame.style.inset = "0";
  root_frame.setAttribute("aria-label", "substrate");
  if (chromeAppliesPerspective(lens)) {
    outer.style.perspective = `${PERSPECTIVE_PX}px`;
    root_frame.style.transform = `rotateX(${ROT_X_DEG}deg) rotateZ(${ROT_Z_DEG}deg)`;
    root_frame.style.transformOrigin = "center center";
  }
  outer.appendChild(root_frame);
  return { outer, root_frame, cleanup };
}

export function mountHost<State extends TickedState, Config, Input, CommitPayload>(
  container: HTMLElement,
  lens: Lens<State, Config, Input, CommitPayload>,
  history: History<State, Config, Input, CommitPayload>,
  opts: MountHostOptions<State> = {},
): MountedHost<State> {
  const base_host = opts.host ?? makeLensHost();
  const renderSize = opts.renderSize;
  const { outer, root_frame, cleanup } = buildFrames(container, lens, renderSize);

  // Embed activity gate — unlike the app chrome, an embed must keep ticking
  // while *unfocused* (an iframe is rarely focused; a self-playing embed has to
  // run on load). It pauses only when the tab is hidden or the embed scrolls
  // out of view. `inView` comes from an IntersectionObserver on `outer`; with
  // the implicit root it's clipped by ancestor frames, so a same-origin iframe
  // scrolled out of the parent viewport reports not-intersecting. (A sandboxed
  // / cross-origin iframe can't see the parent's scroll, so it stays "in view"
  // there and only the tab-hidden gate fires — acceptable, the tick is cheap.)
  let in_view = true;
  const observer =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) in_view = e.isIntersecting;
          },
          { threshold: 0 },
        )
      : null;
  observer?.observe(outer);
  const isActive = (): boolean =>
    in_view && (typeof document === "undefined" || !document.hidden);

  /* ★ ONE CLOSURE, TWO READERS — the lens's `host.isActive()` and the rAF loop's
   * tick gate below are the SAME function, not two implementations of one rule.
   * The loop pauses ticks on `isActive() && isPlaying()`, so a lens asking those
   * two questions learns exactly whether time is moving; if this were a second
   * copy, the answer could drift from the gate and nothing would notice (review
   * protects components, nothing protects wiring).
   *
   * ⚠ DECORATED, not mutated, and it OVERRIDES whatever the caller's host said.
   * `makeLensHost` defaults `isActive` to the window-focus predicate, which is
   * wrong in an iframe; a caller-supplied `opts.host` cannot know it is about to
   * be embedded. This is the only place that knows, so this is where it is
   * decided. The spread is safe — every `LensHost` member is a method closing
   * over its own state, never a field read off `this`. */
  const { host, gate } = activityGate(base_host, isActive);

  // Touch-gesture policy: `outer` is an ancestor of every canvas the lens
  // mounts (full-bleed: outer › center › root_frame; renderSize: outer is the
  // envelope), so its `touch-action` constrains the gesture without the lens
  // having to know it's embedded. Omit ⇒ browser default (page scrolls).
  if (opts.touchAction) outer.style.touchAction = opts.touchAction;

  // Static viewport inset — no chrome panels to dodge, just uniform padding.
  // SAFE_AREA lenses get one immediate fire; nothing ever changes it.
  const inset: ViewportInset = { top: PAD, right: PAD, bottom: PAD, left: PAD };
  const subscribeViewport = (cb: (i: ViewportInset) => void) => {
    cb(inset);
    return () => {};
  };

  const tree = mountLensTree(
    lens,
    outer,
    root_frame,
    history,
    host,
    subscribeViewport,
    renderSize,
    0,
  );

  const profiler = opts.profiler ?? frameProfilerFromEnv(opts.profileLabel);
  // Built-in `?fps` HUD — paints in `outer` (the embed frame) on demand. The
  // app chrome reads the same stats via its toolbar, so it never gates this on.
  const fpsHud: FpsHud | null = fpsHudEnabledFromEnv() ? makeFpsHud(outer) : null;
  const loop = attachRafLoopCore({
    render: () => {
      // The host OWNS the mutable buffer and hands lenses a read-only view of
      // it. `ReadonlyState<State>` is a conditional type over an unresolved
      // generic, so tsc cannot verify `State → ReadonlyState<State>` here even
      // though it holds for every concrete State; this is the one boundary
      // where that narrowing is asserted, deliberately, rather than leaked
      // into the lens contract.
      const state = history.substrate.read as ReadonlyState<State>;
      for (const m of tree.all) m.renderFrom(state);
    },
    ...(tree.root.tick ? { tick: tree.root.tick } : {}),
    ...(tree.root.speedMult ? { speedMult: tree.root.speedMult } : {}),
    isPlaying: () => host.isPlaying(),
    // ⚠ `gate`, NOT a fresh closure: this is the half of the pair the lens does
    // not see, and passing anything else here is the divergence `activityGate`
    // exists to prevent. The only line in this seam no `node` gate can reach.
    isActive: gate,
    reportFps: (stats: FpsStats) => {
      opts.reportFps?.(stats);
      fpsHud?.report(stats);
    },
    ...(profiler ? { profile: profiler.profile } : {}),
  });

  // AUTOPLAY lenses run on mount (SubstrateHost parity). Turn-based lenses
  // stay paused and advance on their own input.
  if ((opts.autoStartIfAutoplay ?? true) && hasFeature(lens, "AUTOPLAY")) {
    host.setPlaying(true);
  }

  return {
    host,
    tree,
    unmount: () => {
      loop.stop();
      observer?.disconnect();
      fpsHud?.destroy();
      tree.unmount();
      cleanup();   // owns BOTH the DOM removal and the style restore (buildFrames)
    },
  };
}
