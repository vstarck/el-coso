/* Blockoide shaft playground lens — a static render bench for the ASCII shaft
 * view, not a game.
 *
 * Like the pit playground, it ignores the live substrate and draws a fixed
 * scene. The shaft view (`view/shaft.ts`) is ASCII (CSS-stacked depth-slice
 * `<pre>`s) and renders straight from a `SubstrateState`, so the bench reuses
 * `makeShaftView` and feeds it a frozen state — starting with the empty
 * 5×5×12 well. The shaft tunables (perspective / glyph set) are forwarded.
 *
 * It does not tick: the host's render-only rAF loop redraws the bench each
 * frame, so tunable edits reflect immediately.
 */

import type { Lens, LensMountArgs, MountedLens } from "@/lenses/types";
import type {
  BlockoideCommitPayload,
  BlockoideConfig,
  BlockoideInputs,
  SubstrateState,
} from "../engine";
import { CADENCE, SPEEDS } from "./controller";
import { makeShaftView, SHAFT_TUNABLES } from "./view/shaft";

const ACCENT = "#41bf00";

// The bench well — empty 5×5×12. (The shaft view reads W/D/H off the config to
// build its slice stack; the rest of the config is inert for a render bench.)
function benchConfig(): BlockoideConfig {
  return {
    id: "shaft-playground",
    W: 5,
    D: 5,
    H: 12,
    gravity_period: 48,
    soft_factor: 10,
    move_period: 5,
    win_layers: 0,
    walls: [],
  };
}

// Empty well, no falling piece.
function emptyState(config: BlockoideConfig): SubstrateState {
  const { W, D, H } = config;
  return {
    W,
    D,
    H,
    cells: new Uint8Array(W * D * H),
    piece_kind: -1,
    orient: 0,
    piece_x: 0,
    piece_y: 0,
    piece_z: 0,
    next_kind: -1,
    drop_acc: 0,
    move_cooldown: 0,
    spawn_count: 0,
    layers: 0,
    outcome: "in_progress",
    tick: 0,
  };
}

function mountShaftPlayground(
  args: LensMountArgs<
    SubstrateState,
    BlockoideConfig,
    BlockoideInputs,
    BlockoideCommitPayload
  >,
): MountedLens<SubstrateState> {
  const config = benchConfig();
  const view = makeShaftView(args.container, config);
  const bench = emptyState(config);

  return {
    unmount: view.unmount,
    renderFrom: () => view.renderFrom(bench), // ignore live state — the bench
    commitGlyph: () => ({ kind: "circle" }),
    pause: () => {},
    resume: () => {},
    step: () => {},
    setSpeed: () => {},
    getTunable: view.getTunable,
    setTunable: view.setTunable,
    subscribeTunables: view.subscribeTunables,
  };
}

export const blockoideShaftPlaygroundLens: Lens<
  SubstrateState,
  BlockoideConfig,
  BlockoideInputs,
  BlockoideCommitPayload
> = {
  id: "blockoide-shaft-playground",
  name: "Shaft Playground",
  tunables: SHAFT_TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "ascii",
  features: ["BOUNDED"],
  theme: { accent: ACCENT },
  mount: mountShaftPlayground,
};
