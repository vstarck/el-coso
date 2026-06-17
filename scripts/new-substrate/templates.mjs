/* The template map: relative package path → (ctx) => content | null.
 * A path present here is generated from the answers; every other file in
 * example/ falls back to the renamed example (config.ts, level.ts, the
 * package barrel, puzzles, README) — so example/ stays the single source
 * for the files no answer affects. */

import { typesTs, channelsTs, stateTs, tickTs, bttfTs, engineIndexTs } from "./templates-engine.mjs";
import { renderTs, lensIndexTs } from "./templates-lens.mjs";

export const TEMPLATES = {
  "engine/types.ts": typesTs,
  "engine/channels.ts": channelsTs, // returns null when storage=plain → file skipped
  "engine/state.ts": stateTs,
  "engine/tick.ts": tickTs,
  "engine/bttf-adapter.ts": bttfTs,
  "engine/index.ts": engineIndexTs,
  "lens/render.ts": renderTs,
  "lens/index.ts": lensIndexTs,
};
