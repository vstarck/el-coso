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
import type { Lens, RenderSize, RenderTarget } from "@/lenses/types";
import { getLensTheme, hasFeature } from "@/lenses/types";
import type { ChromePanelsConfig } from "./store";

// A second card for the same substrate in the gallery, pinned to a specific
// puzzle and/or lens — so one substrate can appear as several entries
// ("conway · glider gun", "conway · life soup"). Clicking it navigates with
// that puzzle/lens applied.
export type GalleryVariant = {
  // Unique within the substrate; forms the card key `<substrate>:<id>`.
  id: string;
  title: string;
  description?: string;
  puzzle?: string;
  lens?: string;
};

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

  // ── Gallery card metadata (all optional) ──────────────────────────────
  // One-line blurb under the title in the gallery modal.
  description?: string;
  // Hand-authored tags (theme / genre), appended after the auto-derived
  // render-target + cadence tags. Omitted ⇒ auto tags only.
  tags?: readonly string[];
  // Square thumbnail image URL (Vite-imported asset / public path). Omitted
  // ⇒ the gallery renders a styled accent-colored placeholder tile.
  thumbnail?: string;
  // Extra gallery cards for the same substrate (puzzle/lens variants).
  galleryVariants?: readonly GalleryVariant[];
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
    description?: string;
    tags?: readonly string[];
    thumbnail?: string;
    galleryVariants?: readonly GalleryVariant[];
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
    ...(m.description ? { description: m.description } : {}),
    ...(m.tags ? { tags: m.tags } : {}),
    ...(m.thumbnail ? { thumbnail: m.thumbnail } : {}),
    ...(m.galleryVariants ? { galleryVariants: m.galleryVariants } : {}),
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

// ── Substrate gallery ────────────────────────────────────────────────────
// The toolbar's compact picker shows only these favorites (plus the active
// substrate if it isn't among them) + a "more…" entry that opens the gallery
// modal. Ids not present are simply skipped; an empty/all-missing list falls
// back to the front of the roster so the picker is never empty.
export const FEATURED: readonly string[] = [
  "conway",
  "tts",
  "tfps",
  "blockoide",
];

export function featuredSubstrates(): SubstrateEntry[] {
  const picked = FEATURED.map((id) => SUBSTRATE_BY_ID[id]).filter(
    (s): s is SubstrateEntry => Boolean(s),
  );
  return picked.length > 0 ? picked : SUBSTRATES.slice(0, 4);
}

// A flat, presentation-ready entry for one gallery card. Derived from a
// SubstrateEntry (+ optional variant); the modal renders these directly.
export type GalleryCard = {
  // `<substrate>` for the base card, `<substrate>:<variantId>` for variants.
  key: string;
  substrateId: string;
  // Navigation targets — undefined means "use the substrate's default".
  puzzleId: string | undefined;
  lensId: string | undefined;
  title: string;
  description: string;
  tags: string[];
  thumbnail: string | undefined;
  accent: string;
};

const TARGET_TAG: Record<RenderTarget, string> = {
  canvas2d: "canvas",
  webgl: "3d",
  dom: "dom",
  ascii: "ascii",
};

// Tags read straight off a lens — render surface + cadence + self-playing.
// No authoring needed; every card gets these.
function autoTagsForLens(lens: Lens<any, any, any, any>): string[] {
  const tags = [TARGET_TAG[lens.target_kind]];
  const turnBased = lens.cadence.pause_condition.kind === "after-every-sample";
  tags.push(turnBased ? "turn-based" : "real-time");
  if (hasFeature(lens, "AUTOPLAY")) tags.push("self-playing");
  return tags;
}

function makeCard(s: SubstrateEntry, v?: GalleryVariant): GalleryCard {
  const variantLens = v?.lens && s.lenses[v.lens] ? v.lens : undefined;
  const lens = s.lenses[variantLens ?? s.defaultLensId] ?? s.lenses[s.defaultLensId];
  return {
    key: v ? `${s.id}:${v.id}` : s.id,
    substrateId: s.id,
    puzzleId: v?.puzzle,
    lensId: variantLens,
    title: v?.title ?? s.name,
    description: v?.description ?? s.description ?? "",
    tags: [...(lens ? autoTagsForLens(lens) : []), ...(s.tags ?? [])],
    thumbnail: s.thumbnail,
    accent: lens ? getLensTheme(lens).accent : "#fbbf24",
  };
}

// Every card the gallery shows: one base card per substrate, plus any
// authored puzzle/lens variants, in roster order.
export function galleryCards(): GalleryCard[] {
  const cards: GalleryCard[] = [];
  for (const s of SUBSTRATES) {
    cards.push(makeCard(s));
    for (const v of s.galleryVariants ?? []) cards.push(makeCard(s, v));
  }
  return cards;
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
