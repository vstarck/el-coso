/* Glyph dictionary — a lens maps its own semantic roles (empty, wall,
 * block, …) to glyphs through data, so the glyph set is overridable
 * without touching render logic. A role's entry is either a
 * single glyph or a ramp (a gradient sampled by a normalized position,
 * e.g. depth: ["█","▓","▒","░"]).
 */

export type GlyphEntry = string | string[];
export type GlyphSet<Role extends string> = Record<Role, GlyphEntry>;

// Pick a glyph from an entry by a normalized position t ∈ [0,1]. A single
// glyph ignores t; a ramp maps t across its length. t clamps to range; an
// empty ramp falls back to a space.
export function rampGlyph(entry: GlyphEntry, t: number): string {
  if (typeof entry === "string") return entry;
  if (entry.length === 0) return " ";
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const i = Math.min(entry.length - 1, Math.floor(clamped * entry.length));
  return entry[i] ?? entry[entry.length - 1] ?? " ";
}
