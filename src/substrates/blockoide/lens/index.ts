/* Blockoide lens barrel — the substrate ships a single orchestrating lens,
 * the deck. It composes a swappable center view (shaft / pit / well) with the
 * chrome-less HUD furniture and owns the sole DeckController. See `deck.ts`
 * (full-app wrapper) and `deck-core.ts` (the store-free composer the embed
 * host reuses).
 */

export { blockoideDeckLens, PIECE_NAMES } from "./deck";
// Static render benches (not games) for iterating on the two 3D views.
export { blockoidePlaygroundLens } from "./playground";
export { blockoideShaftPlaygroundLens } from "./shaft-playground";
