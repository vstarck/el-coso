/* App-tier substrate registry. Type parameters are erased to `any` at the
 * cross-substrate seam (same pattern as session.ts) so the chrome can hold
 * one entry today and a different one tomorrow without rewriting consumers.
 * Substrate-internal code (lens, bundle, adapter, parseLevel) stays fully
 * typed; only this aggregation layer goes wide.
 *
 * The roster is DISCOVERED, not hand-listed. Every package under
 * `src/substrates/<name>/` exports the same normalized barrel — `bundle`,
 * `adapter`, `lenses`, `defaultLensId`, `parseLevel`, `puzzles`, `meta` — so
 * `import.meta.glob` over the folder + a single `buildEntry` projection
 * replaces what used to be one namespace-import + one ~13-line entry per
 * substrate. Adding a substrate is now just creating the package; nothing to
 * edit here (the `new-substrate` wizard's registry-patch step retires with
 * this).
 *
 * Substrates that live OUTSIDE this tree — an external overlay that keeps its
 * packages in a sibling dir, discovered separately — are appended at boot via
 * `registerSubstrates`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { HistoryAdapter } from "../history";
import type { SubstrateBundle } from "../engine/types";
import type { Lens, RenderSize } from "@/lenses/types";
import type { ChromePanelsConfig } from "./store";

export type PuzzleEntry = {
  id: string;
  description: string;
  json: unknown;
};

// `adapter` is either a const (substrates that don't need config to build
// commits) or a factory (substrates whose payload includes config-derived
// fields like outcome). session.ts resolves both via `resolveAdapter` at
// history-construction time.
export type AdapterOrFactory =
  | HistoryAdapter<any, any, any>
  | ((config: any) => HistoryAdapter<any, any, any>);

export type SubstrateEntry = {
  id: string;
  name: string;
  defaultPuzzle: string;
  puzzles: PuzzleEntry[];
  // Per-substrate lens plurality. A substrate ships ≥1 sibling
  // world-lens; chrome lets the player pick at session boot (URL ?lens=)
  // and at runtime (toolbar dropdown, hidden when only one entry).
  lenses: Record<string, Lens<any, any, any, any>>;
  defaultLensId: string;
  bundle: SubstrateBundle<any, any, any>;
  adapter: AdapterOrFactory;
  parseLevel: (json: any) => any;
  // Per-substrate chrome panel config — which panels are available + which
  // default-open. Omitted ⇒ all panels available and open (legacy default).
  chrome?: ChromePanelsConfig;
  // Fixed render envelope (CSS px) for this substrate's lenses. Omitted ⇒
  // full-bleed. The host centers a box of this size; lenses fill / pad it.
  renderSize?: RenderSize;
  // History keyframe period. Dense substrates (Conway's W×H bytes) use a
  // shorter period to keep keyframes cheap; sparse substrates can stretch
  // it. A moderate SoA keeps replay cost predictable around 100.
  keyframePeriod: number;
};

// The normalized barrel every `src/substrates/<name>/index.ts` exports — what
// the glob (and the private overlay) hand to `buildEntry`. Chrome-only fields
// (`chrome` / `renderSize`) ride on `meta`.
export type SubstrateModule = {
  bundle: SubstrateBundle<any, any, any>;
  adapter: AdapterOrFactory;
  lenses: Record<string, Lens<any, any, any, any>>;
  defaultLensId: string;
  parseLevel: (json: any) => any;
  puzzles: unknown[];
  meta: {
    id: string;
    name: string;
    defaultPuzzle: string;
    keyframePeriod: number;
    chrome?: ChromePanelsConfig;
    renderSize?: RenderSize;
  };
};

function puzzle(json: unknown): PuzzleEntry {
  const o = json as { id?: string; description?: string };
  return {
    id: typeof o.id === "string" ? o.id : "unknown",
    description: typeof o.description === "string" ? o.description : "",
    json,
  };
}

function buildEntry(mod: SubstrateModule): SubstrateEntry {
  const m = mod.meta;
  return {
    id: m.id,
    name: m.name,
    defaultPuzzle: m.defaultPuzzle,
    puzzles: mod.puzzles.map(puzzle),
    lenses: mod.lenses,
    defaultLensId: mod.defaultLensId,
    bundle: mod.bundle,
    adapter: mod.adapter,
    parseLevel: mod.parseLevel,
    keyframePeriod: m.keyframePeriod,
    // Conditional spread, not `chrome: m.chrome` — exactOptionalPropertyTypes
    // forbids assigning `undefined` to the optional fields.
    ...(m.chrome ? { chrome: m.chrome } : {}),
    ...(m.renderSize ? { renderSize: m.renderSize } : {}),
  };
}

// Front-of-roster order: the toolbar picker order, and SUBSTRATES[0] = the
// default substrate when no `?substrate=` is given. Ids not listed fall after,
// sorted by name — so a newly-scaffolded package shows up automatically without
// touching this file (and any package injected at boot via registerSubstrates
// orders itself the same way).
const ORDER = [
  "conway",
  "tts",
  "tfps",
  "blockoide",
  "tron",
  "pentris",
  "dvd-screensaver",
  "example",
];

function rank(id: string): number {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
}

function byRank(a: SubstrateEntry, b: SubstrateEntry): number {
  return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
}

export const SUBSTRATES: SubstrateEntry[] = Object.values(
  import.meta.glob<SubstrateModule>("../substrates/*/index.ts", { eager: true }),
)
  .map(buildEntry)
  .sort(byRank);

export const SUBSTRATE_BY_ID: Record<string, SubstrateEntry> = {};

// Rebuilt in place (not reassigned) so the exported binding stays the same
// reference that drill-in captured via `setDrillRegistry(SUBSTRATES)`.
function reindex(): void {
  for (const key of Object.keys(SUBSTRATE_BY_ID)) delete SUBSTRATE_BY_ID[key];
  for (const s of SUBSTRATES) SUBSTRATE_BY_ID[s.id] = s;
}
reindex();

// Append substrates discovered OUTSIDE this tree (an external overlay).
// Mutates the live `SUBSTRATES` array + `SUBSTRATE_BY_ID` in place so existing
// importers (Toolbar, and drill-in via `setDrillRegistry`) see the additions.
// MUST run before the app's `session` module loads — it reads SUBSTRATES /
// resolveInitialSelection at import time — so the overlay registers first, then
// imports the app. First registration of an id wins (re-registers are ignored).
export function registerSubstrates(mods: SubstrateModule[]): void {
  for (const mod of mods) {
    const entry = buildEntry(mod);
    if (SUBSTRATE_BY_ID[entry.id]) continue;
    SUBSTRATES.push(entry);
  }
  SUBSTRATES.sort(byRank);
  reindex();
}

export function findPuzzle(
  substrate: SubstrateEntry,
  id: string,
): PuzzleEntry | undefined {
  return substrate.puzzles.find((p) => p.id === id);
}

// URL ?substrate=…&puzzle=…&lens=… resolution. Falls back to the first
// registered substrate's default puzzle and the active substrate's
// defaultLensId. Unknown lens id silently falls back to defaultLensId.
export function resolveInitialSelection(): {
  substrate: SubstrateEntry;
  puzzle: PuzzleEntry;
  lensId: string;
} {
  const default_substrate = SUBSTRATES[0]!;
  const params = typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const sid = params.get("substrate");
  const substrate = (sid && SUBSTRATE_BY_ID[sid]) || default_substrate;
  const pid = params.get("puzzle") ?? substrate.defaultPuzzle;
  const puzzle = findPuzzle(substrate, pid) ?? findPuzzle(substrate, substrate.defaultPuzzle)!;
  const requested = params.get("lens");
  const lensId = (requested && substrate.lenses[requested])
    ? requested
    : substrate.defaultLensId;
  return { substrate, puzzle, lensId };
}

export function writeSelectionToUrl(
  substrate_id: string,
  puzzle_id: string,
  lens_id: string,
): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("substrate", substrate_id);
  params.set("puzzle", puzzle_id);
  // Only pin the lens to the URL when it's not the substrate's default —
  // keeps shareable URLs uncluttered for the common case.
  const substrate = SUBSTRATE_BY_ID[substrate_id];
  if (substrate && lens_id !== substrate.defaultLensId) {
    params.set("lens", lens_id);
  } else {
    params.delete("lens");
  }
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", next);
}
