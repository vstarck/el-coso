/* Example — substrate package barrel.
 *
 * Shipped as the executable template for the design-questions pipeline
 * documented in `docs/guide.md`. Copy this directory to
 * `src/substrates/<name>/` when authoring a new substrate, then rename
 * `Example` → `<Name>` everywhere and replace the no-op tick with the
 * real dynamics.
 */

import { exampleBundle, exampleBttfAdapter, parseLevel } from "./engine";
import { exampleLens } from "./lens";
import example0 from "./puzzles/example-0.json";

export const bundle = exampleBundle;
export const adapter = exampleBttfAdapter;
export const lenses = { "example-grid": exampleLens } as const;
export const defaultLensId = "example-grid";
export { parseLevel };
export const puzzles: unknown[] = [example0];
export const meta = {
  id: "example",
  name: "Example",
  defaultPuzzle: "example-0",
  keyframePeriod: 100,
} as const;

export * from "./engine";
