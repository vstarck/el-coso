/* Blockoide — substrate package barrel.
 *
 * Blockout (3D Tetris): polycubes fall down a W×D×H well; the player slides
 * and rotates in three axes; a completed horizontal layer clears. The
 * substrate ships a single orchestrating lens — the **deck** — which composes
 * a swappable center view (shaft = the 3D pit in pure ASCII; pit = the same
 * view via canvas2d; well = the reference ascii top-down view) with the
 * chrome-less HUD furniture (title / altimeter / stats / controls) and owns
 * the sole history-driving controller. Commits land per piece lock and carry
 * a content hash.
 */

import {
  blockoideBundle,
  blockoideBttfAdapter,
  parseLevel,
  KEYFRAME_PERIOD,
} from "./engine";
import {
  blockoideDeckLens,
  blockoidePlaygroundLens,
  blockoideShaftPlaygroundLens,
} from "./lens";
import sprint from "./puzzles/sprint.json";
import endless from "./puzzles/endless.json";
import pillar from "./puzzles/pillar.json";

export const bundle = blockoideBundle;
export const adapter = blockoideBttfAdapter;
export const lenses = {
  "blockoide-deck": blockoideDeckLens,
  "blockoide-playground": blockoidePlaygroundLens,
  "blockoide-shaft-playground": blockoideShaftPlaygroundLens,
} as const;
export const defaultLensId = "blockoide-deck";
export { parseLevel };
export const puzzles: unknown[] = [sprint, endless, pillar];
export const meta = {
  id: "blockoide",
  name: "Blockoide",
  description:
    "Blockout — 3D Tetris: drop tetracubes into a pit and clear full layers.",
  defaultPuzzle: "sprint",
  keyframePeriod: KEYFRAME_PERIOD,
} as const;

export * from "./engine";
