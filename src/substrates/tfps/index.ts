/* tfps — substrate package barrel.
 *
 * Terminal FPS: a Wolfenstein-style raycaster whose single lens renders the
 * world as 120-column colored ASCII on a canvas, dressed in the terminal/CRT
 * kit (the Akira-arcade look). State is a camera pose; Causality is locomotion
 * with wall-sliding collision. A patrol bot self-plays on load; the arrow keys
 * take over. A portfolio SHOWCASE — direct movement, not the indirect-agency
 * thesis. v1 is a pure walkthrough (no combat).
 */

import { tfpsBundle, tfpsBttfAdapter, parseLevel } from "./engine";
import { tfpsLens } from "./lens";
import e1m1 from "./puzzles/e1m1.json";

export const bundle = tfpsBundle;
export const adapter = tfpsBttfAdapter;
export const lenses = { "tfps-raycast": tfpsLens } as const;
export const defaultLensId = "tfps-raycast";
export { parseLevel };
export const puzzles: unknown[] = [e1m1];
export const meta = {
  id: "tfps",
  name: "tfps",
  description:
    "A terminal FPS — an ASCII raycaster with a self-playing patrol bot, drawn in colored glyphs.",
  defaultPuzzle: "e1m1",
  keyframePeriod: 120,
} as const;

export * from "./engine";
