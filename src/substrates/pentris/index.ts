/* Pentris — substrate package barrel.
 *
 * A falling-block stacker on the twelve free pentominoes, with a
 * three-column "Workbench" lens: a DOM state inspector, the canvas well,
 * and a click-to-fork in-canvas history tree. Commits land per piece
 * spawn and carry a content hash of the configuration as their address.
 */

import { pentrisBundle, pentrisBttfAdapter, parseLevel } from "./engine";
import { pentrisLens } from "./lens";
import { pentrisManualLens } from "./lens/manual";
import pentris0 from "./puzzles/pentris-0.json";
import pentrisSprint from "./puzzles/pentris-sprint.json";

export const bundle = pentrisBundle;
export const adapter = pentrisBttfAdapter;
export const lenses = {
  "pentris-workbench": pentrisLens,
  "pentris-manual": pentrisManualLens,
} as const;
export const defaultLensId = "pentris-workbench";
export { parseLevel };
export const puzzles: unknown[] = [pentris0, pentrisSprint];
export const meta = {
  id: "pentris",
  name: "Pentris",
  defaultPuzzle: "pentris-0",
  keyframePeriod: 100,
} as const;

export * from "./engine";
