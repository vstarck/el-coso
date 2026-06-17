/* dvd-screensaver lens — assembles the composite from the base space lens, the
 * four toggleable overlays, and the toggle HUD via `composeSimpleSpace`. The
 * scaffold sets `layers = [...overlays, hud]`, recovers the mounted children by
 * id, and forwards each HUD `["show", <overlay.id>]` toggle to the matching
 * overlay's `["visible"]` tunable. The fragile cross-file ordering coupling the
 * longhand once carried now lives inside the scaffold. */

import type { Lens } from "@/lenses/types";
import { composeSimpleSpace } from "@/lib/lens-host/compose-space";
import type {
  DvdCommitPayload,
  DvdConfig,
  DvdInputs,
  SubstrateState,
} from "../engine";
import { dvdSpaceLens } from "./space";
import { dvdVelocityLens } from "./velocity";
import { dvdAccelerationLens } from "./acceleration";
import { dvdJitterLens } from "./jitter";
import { dvdProjectionLens } from "./projection";
import { dvdHudLens } from "./hud";

export const dvdLens: Lens<
  SubstrateState,
  DvdConfig,
  DvdInputs,
  DvdCommitPayload
> = composeSimpleSpace(dvdSpaceLens, {
  overlays: [
    dvdVelocityLens,
    dvdAccelerationLens,
    dvdJitterLens,
    dvdProjectionLens,
  ],
  hud: dvdHudLens,
});
