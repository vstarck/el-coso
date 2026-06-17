/* Well center-view — the well top-down as a small-font <pre>, the reference
 * ASCII surface (the cell-buffer IR) materialized by the HTML
 * backend. Write-only, no listeners. Resolution is the `cell_chars` tunable
 * (rows per game cell); columns follow the ~0.6 monospace aspect so cells
 * read square.
 *
 * Extracted from the former `blockoide-well` lens — render half only.
 */

import { renderToPre } from "@/lib/ascii";
import type { GlyphSet } from "@/lib/ascii";
import type { LensTunable, TunableValue } from "@/lenses/types";
import type { BlockoideConfig, SubstrateState } from "../../engine";
import {
  buildWellSurface,
  GLYPH_SETS,
  type GlyphSetId,
  type Role,
} from "../render";
import type { CenterView } from "./types";

const CELL_ASPECT = 1.667;
const CELL_ROWS = ["2", "4", "6", "8"];

function ssFor(rows: string): { ssx: number; ssy: number } {
  const ssy = Math.max(1, Number(rows) || 6);
  return { ssx: Math.max(1, Math.round(ssy * CELL_ASPECT)), ssy };
}

export const WELL_TUNABLES: LensTunable[] = [
  {
    id: "cell_chars",
    group: "Lens",
    label: "Cell rows",
    type: "enum",
    options: CELL_ROWS,
    target: "lens",
    path: ["cell_chars"],
  },
  {
    id: "glyph_set",
    group: "Lens",
    label: "Glyph set",
    type: "enum",
    options: Object.keys(GLYPH_SETS),
    target: "lens",
    path: ["glyph_set"],
  },
];

export function makeWellView(
  slot: HTMLElement,
  _config: BlockoideConfig,
): CenterView {
  const well = document.createElement("pre");
  well.className = "blk-well";
  well.setAttribute("aria-label", "blockoide well");
  slot.appendChild(well);

  const lens_state: Record<string, string> = {
    glyph_set: "blocks",
    cell_chars: "6",
  };
  const tunableListeners = new Set<() => void>();
  function glyphSet(): GlyphSet<Role> {
    const id = lens_state.glyph_set as GlyphSetId;
    return GLYPH_SETS[id] ?? GLYPH_SETS.blocks!;
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    return lens_state[path[0] ?? ""];
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if (key === "glyph_set" && typeof value === "string" && value in GLYPH_SETS) {
      lens_state.glyph_set = value;
      for (const cb of tunableListeners) cb();
    } else if (
      key === "cell_chars" &&
      typeof value === "string" &&
      CELL_ROWS.includes(value)
    ) {
      lens_state.cell_chars = value;
      for (const cb of tunableListeners) cb();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  function renderFrom(state: SubstrateState): void {
    const { ssx, ssy } = ssFor(lens_state.cell_chars ?? "6");
    renderToPre(buildWellSurface(state, glyphSet(), ssx, ssy), well);
  }

  return {
    renderFrom,
    unmount: () => {
      if (well.parentNode === slot) slot.removeChild(well);
    },
    tunables: WELL_TUNABLES,
    getTunable,
    setTunable,
    subscribeTunables,
  };
}
