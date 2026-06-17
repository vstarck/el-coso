import { useEffect, useRef } from "react";
import {
  chromeAppliesPerspective,
  hasFeature,
  type ViewportInset,
} from "@/lenses/types";
import {
  mountLensTree,
  type LensTree,
} from "@/lib/lens-host/mount-tree";
import {
  attachRafLoop,
  type RafLoopHandle,
  type RafLoopOpts,
} from "../../lib/lens-host/raf-loop";
import { storeLensHost } from "../../lib/lens-host/store-host";
import { computeVisibleInset, insetsEqual, PAD } from "../../layout";
import { resolveActiveSceneIfTerminal } from "../../lib/scenes/scene-stack";
import { isReviewing, reviewState } from "../../lib/scenes/drill-in";
import { getActiveTransition } from "../../lib/scenes/transition";
import { renderSizeFor, session } from "../../session";
import { useStore, type PanelsState } from "../../store";
import type { History, TickedState } from "../../../history";

// Detached copy of a lens canvas, captured before unmount so a cutscene can
// render the outgoing frame after its source canvas is gone.
function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  if (src.width === 0 || src.height === 0) return null;
  const copy = document.createElement("canvas");
  copy.width = src.width;
  copy.height = src.height;
  const ctx = copy.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0);
  return copy;
}

// Full-bleed substrate host. The chrome panels (toolbar,
// inspector, rules, timeline) sit on top as glass overlays — the
// substrate IS the background, the HUD is what's drawn over it. A subtle
// CSS perspective hints that the substrate isn't a flat plane (the torus
// dimension we can't directly show with a 2D canvas). Tweak the angles
// below to dial the curvature feel. Applied only when
// `chromeAppliesPerspective(lens)` returns true — pixel-surface lenses
// that don't declare BOUNDED or FLAT.
const PERSPECTIVE_PX = 2400;
const ROT_X_DEG = 8;
const ROT_Z_DEG = 0;

// The safe-area inset a SAFE_AREA lens should dodge. Normally this is the
// region occluded by chrome panels. But a render-sized substrate draws into a
// centered box in negative space that panels never overlap, so its HUD only
// wants uniform breathing room (PAD) — not a top-of-window toolbar's height
// reflected as a gap inside the small box.
function effectiveInset(panels: PanelsState): ViewportInset {
  if (renderSizeFor(session.active_substrate_id)) {
    return { top: PAD, right: PAD, bottom: PAD, left: PAD };
  }
  return computeVisibleInset(panels);
}

export function SubstrateHost() {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const rootHostRef = useRef<HTMLDivElement | null>(null);
  // Re-mount whenever the substrate/puzzle changes (sessionVersion) OR the
  // active scene frame changes (sceneVersion — a scene push/pop). session.ts
  // already projects the new active frame's `active_lens` / `history` by the
  // time this effect re-runs.
  const sessionVersion = useStore((s) => s.sessionVersion);
  const sceneVersion = useStore((s) => s.sceneVersion);
  // Re-mount when entering / leaving / descending a drill-in review
  // session.ts already projects the review frame's history +
  // child lens by the time this effect re-runs.
  const drillVersion = useStore((s) => s.drillVersion);
  // Teardown handles for the current mount + the outgoing snapshot captured
  // for the next cutscene. Refs because the mount is async (it awaits the
  // transition) while cleanup is synchronous.
  const mountedRef = useRef<{ raf: RafLoopHandle; tree: LensTree<TickedState> } | null>(null);
  const pendingFromRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport-inset publication channel (SAFE_AREA feature, see
  // LensMountArgs.subscribeViewport). Refs persist across remounts so
  // panel changes still notify the active lens. Each subscriber is
  // fired once on subscribe with the current inset, and again on every
  // panel-open/close transition.
  const insetSubscribersRef = useRef(new Set<(inset: ViewportInset) => void>());
  const currentInsetRef = useRef<ViewportInset>(
    effectiveInset(useStore.getState().panels),
  );
  useEffect(() => {
    return useStore.subscribe((s, prev) => {
      if (s.panels === prev.panels) return;
      const next = effectiveInset(s.panels);
      if (insetsEqual(currentInsetRef.current, next)) return;
      currentInsetRef.current = next;
      for (const cb of insetSubscribersRef.current) cb(next);
    });
  }, []);

  useEffect(() => {
    const outer = outerRef.current;
    const root_host = rootHostRef.current;
    if (!outer || !root_host) return;
    let cancelled = false;
    const subscribeViewport = (cb: (inset: ViewportInset) => void) => {
      insetSubscribersRef.current.add(cb);
      cb(currentInsetRef.current);
      return () => insetSubscribersRef.current.delete(cb);
    };

    // Capture the outgoing snapshot saved by the previous cleanup + the
    // requested cutscene direction (null = instant cut: substrate swap /
    // initial mount). The cutscene plays in the unmount→mount gap.
    const from = pendingFromRef.current;
    pendingFromRef.current = null;
    const direction = useStore.getState().sceneDirection;
    const transition = getActiveTransition();

    // Snapshot the active frame NOW so the rAF renders against the frame
    // this mount belongs to — even after a later pop swaps session.history
    // (avoids pairing this lens's renderer with a different substrate's
    // state during the brief window before React tears this mount down).
    const lens = session.active_lens;
    const history = session.history;
    const renderSize = renderSizeFor(session.active_substrate_id);
    // Recompute the inset for the (possibly newly-switched) substrate before
    // the lens subscribes below, so a render-sized substrate's HUD gets the
    // uniform safe-area rather than a stale panel-occlusion inset.
    currentInsetRef.current = effectiveInset(useStore.getState().panels);
    // A review mount is read-only: no tick, no AUTOPLAY, no scene
    // resolve poll. It renders the inner history at the live playhead via
    // historyStateAt. Captured at mount — a later enter/leave bumps
    // drillVersion and re-mounts.
    const reviewing = isReviewing();

    async function mount() {
      if (from && direction) {
        try {
          await transition(from, direction, outer!);
        } catch {
          /* best-effort: a thrown transition degrades to an instant cut */
        }
      }
      if (cancelled) return;

      const tree = mountLensTree(
        lens,
        outer!,
        root_host!,
        history,
        storeLensHost,
        subscribeViewport,
        renderSize,
        0,
      );
      session.mounted_lens = tree.root;

      // Single host-owned rAF. Calls every mount's renderFrom each frame
      // (root + descendants flat); only the root's tick (if present) drives
      // substrate advance. After rendering, poll the scene runtime — when an
      // active child scene terminates, it pops back to the parent.
      const raf_opts: RafLoopOpts = {
        render: reviewing
          ? () => {
              // Read-only: render the inner history at the live scrub
              // position. reviewState() runs historyStateAt (never
              // historyTick) and returns null if review ended out from
              // under us before the re-mount lands.
              const state = reviewState();
              if (state) for (const m of tree.all) m.renderFrom(state);
            }
          : () => {
              const state = history.substrate.read;
              for (const m of tree.all) m.renderFrom(state);
              resolveActiveSceneIfTerminal();
            },
        isPlaying: () => useStore.getState().playing,
      };
      // No tick driver while reviewing — the recording is frozen; the user
      // scrubs the playhead, the render samples it.
      if (!reviewing && tree.root.tick) raf_opts.tick = tree.root.tick;
      if (!reviewing && tree.root.speedMult) raf_opts.speedMult = tree.root.speedMult;
      const raf = attachRafLoop(raf_opts);
      mountedRef.current = { raf, tree };

      // Autonomous lenses (AUTOPLAY) start running on mount — the previous
      // "Conway just runs" behavior. Turn-based lenses (no AUTOPLAY) stay
      // paused; their store.playing is irrelevant since the chrome hides
      // the play button anyway. Suppressed for a review mount (read-only).
      if (!reviewing && hasFeature(lens, "AUTOPLAY")) {
        useStore.getState().setPlaying(true);
      }
      useStore.getState().bumpHistoryVersion();
    }
    void mount();

    return () => {
      cancelled = true;
      const m = mountedRef.current;
      if (m) {
        // Capture a detached copy of the outgoing frame for the next
        // cutscene BEFORE unmount removes the lens canvas.
        const snap = session.mounted_lens?.snapshot?.();
        pendingFromRef.current = snap ? copyCanvas(snap) : null;
        m.raf.stop();
        m.tree.unmount();
        mountedRef.current = null;
      }
      session.mounted_lens = null;
    };
  }, [sessionVersion, sceneVersion, drillVersion]);

  // Toolbar bumps snapshotToken to request a snapshot. Root lens decides
  // what to capture via `snapshot()` — leaf lenses typically return
  // their own canvas; composing lenses can return an off-screen
  // composite of their children. Non-pixel-surface lenses (DOM/ASCII)
  // omit it and the snapshot quietly no-ops.
  const snapshotToken = useStore((s) => s.snapshotToken);
  useEffect(() => {
    if (snapshotToken === 0) return;
    const mounted = session.mounted_lens;
    if (!mounted) return;
    const canvas = mounted.snapshot?.();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const tick = session.history.substrate.read.tick;
      const stem = `snapshot-tick-${String(tick).padStart(6, "0")}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }, [snapshotToken]);

  // Subscribe to sessionVersion (already above) so the chrome rerenders
  // when the lens changes and we pick up the new layout features.
  const lens = session.active_lens;
  const renderSize = renderSizeFor(session.active_substrate_id);
  const bounded = hasFeature(lens, "BOUNDED");
  const wantsPerspective = chromeAppliesPerspective(lens);

  // A substrate-declared fixed render envelope wins over the lens's own
  // layout features: the whole lens tree (root + child layers, e.g. the
  // in-canvas HUD) renders inside one centered box of this size, so an
  // embedded substrate has a known footprint. Unlike BOUNDED — where the
  // root is a small centered canvas but child overlays stay full-viewport —
  // here `outerRef` (children mount) and `rootHostRef` (root mounts) are the
  // SAME box, so the HUD is scoped inside the envelope alongside the park.
  const setEnvelopeRef = (el: HTMLDivElement | null) => {
    outerRef.current = el;
    rootHostRef.current = el;
  };
  if (renderSize) {
    return (
      <div
        className="absolute inset-0 vignette flex items-center justify-center"
        style={{ isolation: "isolate" }}
      >
        <div
          ref={setEnvelopeRef}
          className="relative overflow-hidden"
          style={{ width: renderSize.width, height: renderSize.height }}
          aria-label="substrate"
        />
      </div>
    );
  }

  // Layout structure:
  // - `outerRef`     = full-viewport surface, parent of all child-lens
  //                    sibling frames.
  // - `rootHostRef`  = where the root mounts; styling depends on
  //                    features (BOUNDED-centered / perspective-tilted
  //                    / flat).
  // Both refs MUST resolve to elements present in every branch below.
  // `isolation: isolate` on the outer establishes a stacking context
  // here, so any z-indices the lens tree uses internally (child layer
  // frames stacked above the root) stay scoped inside SubstrateHost
  // and can't leak out to compete with chrome panels rendered as
  // siblings-after-SubstrateHost in App.tsx. Chrome stays the outermost
  // visual layer by construction.
  if (bounded) {
    // BOUNDED lens: the root sizes its own host element
    // naturally (canvas with explicit width/height), so the inner
    // wrapper just flex-centers it inside the full-viewport outer.
    // Child lens frames (HUD overlays, etc.) live as siblings of the
    // centering wrapper — full-viewport, so they aren't clipped to
    // the small bounded canvas. `pointer-events: none` on the
    // centering wrapper lets clicks pass through to children or to
    // the root via its own auto-pointer-events.
    return (
      <div
        ref={outerRef}
        className="absolute inset-0 vignette"
        style={{ isolation: "isolate" }}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            ref={rootHostRef}
            className="pointer-events-auto relative"
            aria-label="substrate"
          />
        </div>
      </div>
    );
  }

  if (wantsPerspective) {
    // Default full-bleed with the chrome's perspective tilt applied to
    // the root's host element only (so child overlays stay flat above
    // a tilted world).
    return (
      <div
        ref={outerRef}
        className="absolute inset-0 vignette"
        style={{ perspective: `${PERSPECTIVE_PX}px`, isolation: "isolate" }}
      >
        <div
          ref={rootHostRef}
          className="absolute inset-0"
          style={{
            transform: `rotateX(${ROT_X_DEG}deg) rotateZ(${ROT_Z_DEG}deg)`,
            transformOrigin: "center center",
          }}
          aria-label="substrate"
        />
      </div>
    );
  }

  // FLAT pixel surface, or any DOM/ASCII target: full-bleed root in a
  // full-bleed outer. Children live as siblings of the root.
  return (
    <div
      ref={outerRef}
      className="absolute inset-0 vignette"
      style={{ isolation: "isolate" }}
    >
      <div
        ref={rootHostRef}
        className="absolute inset-0"
        aria-label="substrate"
      />
    </div>
  );
}
