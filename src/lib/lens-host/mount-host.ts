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
  type RenderSize,
  type ViewportInset,
} from "@/lenses/types";
import type { History, TickedState } from "@/history";
import { attachRafLoopCore } from "./raf-loop-core";
import { makeLensHost } from "./host";
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

export type MountHostOptions<State extends TickedState> = {
  /** Inject a host (e.g. one wired to a transport UI). Defaults to a fresh
   *  store-free `makeLensHost`. */
  host?: ReturnType<typeof makeLensHost>;
  /** The substrate's fixed render envelope (`meta.renderSize`), if any. When
   *  present the whole lens tree renders inside one centered box of this size
   *  rather than full-bleed. */
  renderSize?: RenderSize | undefined;
  /** Start an AUTOPLAY lens running on mount (the app's behavior). Default
   *  true. */
  autoStartIfAutoplay?: boolean;
  /** Optional rolling-fps sink (uncapped render rate either way). */
  reportFps?: (fps: number) => void;
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
  const cleanup = () => {
    container.style.position = prev_position;
  };

  const outer = document.createElement("div");
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
  const host = opts.host ?? makeLensHost();
  const renderSize = opts.renderSize;
  const { outer, root_frame, cleanup } = buildFrames(container, lens, renderSize);

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

  const loop = attachRafLoopCore({
    render: () => {
      const state = history.substrate.read;
      for (const m of tree.all) m.renderFrom(state);
    },
    ...(tree.root.tick ? { tick: tree.root.tick } : {}),
    ...(tree.root.speedMult ? { speedMult: tree.root.speedMult } : {}),
    isPlaying: () => host.isPlaying(),
    isActive,
    ...(opts.reportFps ? { reportFps: opts.reportFps } : {}),
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
      tree.unmount();
      if (outer.parentNode === container) container.removeChild(outer);
      cleanup();
    },
  };
}
