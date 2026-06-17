/* composeSimpleSpace — the first author-side composite scaffold.
 *
 * Turns a base "space" lens (renders the world + drives the tick) plus a set of
 * toggleable overlay lenses and an optional toggle HUD into a single composing
 * `Lens`. It is a DECORATOR over the base space's MountedLens: every API method
 * delegates to the base except `snapshot` (composited across children) and
 * `unmount` (also tears down the HUD subscription). The base lens never knows
 * it was composed.
 *
 * Why this exists. A composing root has to (a) recover which mounted child is
 * which — `args.children` arrives as anonymous handles in `layers` order — and
 * (b) forward HUD toggle state to the matching overlay's `visible` tunable.
 * Done longhand in a substrate (dvd-screensaver) that mapping smears a
 * load-bearing ordering decision across three files and bakes in "the HUD is
 * the last child". Here both ends are owned by one function: children are
 * recovered by zipping the declared `layers` order against `args.children`
 * (the host's documented invariant), and addressed by lens id,
 * so the author writes intent (`overlays`, `hud`) instead of index arithmetic.
 *
 * Scope is deliberately the SIMPLE case: one space, a flat list of overlays,
 * zero-or-one HUD, one boolean toggle per overlay. Multi-HUD, dynamic children,
 * or non-boolean coordination compose their own root or grow a sibling scaffold
 * — they don't bend this one.
 *
 * Chrome-tier (lens-host): imports app-tier Lens types + DOM canvas. Not
 * translatable. */

import type { TickedState } from "@/history";
import type {
  Lens,
  LensFeature,
  LensMountArgs,
  LensTheme,
  MountedLens,
  TunableValue,
} from "@/lenses/types";

export type ComposeSimpleSpaceOptions<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
> = {
  // Overlay lenses the HUD toggles. Mounted below the HUD in array order
  // (first = bottom). Each is shown/hidden via its `visiblePath` tunable.
  overlays?: ReadonlyArray<Lens<State, Config, Input, CommitPayload>>;
  // Optional toggle HUD. Owns the visibility booleans as view-state and
  // answers `toggleKey(overlay)`; mounted on top (last layer). Omit for a
  // composite with no in-canvas toggles (overlays then keep their own
  // default visibility).
  hud?: Lens<State, Config, Input, CommitPayload>;
  // HUD tunable path that holds an overlay's visibility flag.
  // Default: ["show", overlay.id].
  toggleKey?: (overlay: Lens<State, Config, Input, CommitPayload>) => string[];
  // Overlay tunable path the flag is written to. Default: ["visible"].
  visiblePath?: string[];
  // Identity overrides — default to inheriting the base space's values.
  id?: string;
  name?: string;
  features?: LensFeature[];
  theme?: LensTheme;
};

export function composeSimpleSpace<
  State extends TickedState,
  Config,
  Input,
  CommitPayload,
>(
  space: Lens<State, Config, Input, CommitPayload>,
  options: ComposeSimpleSpaceOptions<State, Config, Input, CommitPayload> = {},
): Lens<State, Config, Input, CommitPayload> {
  const overlays = options.overlays ?? [];
  const hud = options.hud;
  const toggleKey = options.toggleKey ?? ((overlay) => ["show", overlay.id]);
  const visiblePath = options.visiblePath ?? ["visible"];

  // z-order: overlays bottom-up, then the HUD on top. This is the order the
  // host mounts them and the order `args.children` arrives in.
  const layers: Lens<State, Config, Input, CommitPayload>[] = [...overlays];
  if (hud) layers.push(hud);

  function mount(
    args: LensMountArgs<State, Config, Input, CommitPayload>,
  ): MountedLens<State> {
    const base = space.mount(args);
    const children = args.children ?? [];

    // Recover role → handle by zipping our declared `layers` against the
    // ordered children (host invariant: children[i] is layers[i]).
    // Addressed by lens id so a reordering of `layers` can't misroute.
    const byId: Record<string, MountedLens<State>> = {};
    for (let i = 0; i < layers.length; i++) {
      const handle = children[i];
      if (handle) byId[layers[i]!.id] = handle;
    }
    const hudHandle = hud ? byId[hud.id] : undefined;

    // Forward each overlay's HUD toggle to its `visible` tunable. An overlay
    // the HUD doesn't answer for keeps its own default visibility.
    function syncVisibility(): void {
      if (!hudHandle) return;
      for (const overlay of overlays) {
        const flag = hudHandle.getTunable(toggleKey(overlay));
        if (flag === undefined) continue;
        byId[overlay.id]?.setTunable(visiblePath, flag as TunableValue);
      }
    }
    const unsubscribeHud = hudHandle?.subscribeTunables(syncVisibility);
    syncVisibility(); // push initial state down

    // Composite snapshot: base canvas with every child drawn over it, so a
    // saved PNG carries whatever overlays are currently visible.
    function snapshot(): HTMLCanvasElement | null {
      const baseCanvas = base.snapshot?.();
      if (!baseCanvas) return null;
      const off = document.createElement("canvas");
      off.width = baseCanvas.width;
      off.height = baseCanvas.height;
      const octx = off.getContext("2d");
      if (!octx) return baseCanvas;
      octx.drawImage(baseCanvas, 0, 0);
      for (const child of children) {
        const cc = child.snapshot?.();
        if (cc) octx.drawImage(cc, 0, 0);
      }
      return off;
    }

    return {
      ...base,
      snapshot,
      unmount: () => {
        if (unsubscribeHud) unsubscribeHud();
        base.unmount();
      },
    };
  }

  const features = options.features ?? space.features;
  const theme = options.theme ?? space.theme;
  return {
    id: options.id ?? space.id,
    name: options.name ?? space.name,
    tunables: space.tunables,
    speeds: space.speeds,
    cadence: space.cadence,
    target_kind: space.target_kind,
    // features/theme are optional on Lens; under exactOptionalPropertyTypes we
    // omit rather than set them to undefined when neither source defines one.
    ...(features ? { features } : {}),
    ...(theme ? { theme } : {}),
    layers,
    mount,
  };
}
