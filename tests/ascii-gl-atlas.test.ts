/* GL glyph-atlas packing (S119) — the pure logic behind makeGlRenderer's fixed,
 * pre-packed texture. The render loop needs a real WebGL2 context (verified
 * in-browser via ?profile A/B); these are the parts that must be exactly right for
 * the shader's per-instance UV to land on the correct glyph: slot assignment, the
 * reserved tofu, dedup, capacity, and the slot→atlas-cell mapping.
 */
import { describe, it, expect, vi } from "vitest";
import { buildGlyphIndex, slotCell, TOFU_GLYPH, ATLAS_COLS, ATLAS_ROWS } from "../src/lib/ascii";

describe("buildGlyphIndex", () => {
  it("reserves slot 0 for the tofu box (the render-time miss fallback)", () => {
    const ix = buildGlyphIndex("abc");
    expect(ix.slots[0]).toBe(TOFU_GLYPH);
    expect(ix.byGlyph.get(TOFU_GLYPH)).toBe(0);
  });

  it("assigns glyphs to slots 1..N in first-seen order", () => {
    const ix = buildGlyphIndex("abc");
    expect(ix.byGlyph.get("a")).toBe(1);
    expect(ix.byGlyph.get("b")).toBe(2);
    expect(ix.byGlyph.get("c")).toBe(3);
    expect(ix.slots).toEqual([TOFU_GLYPH, "a", "b", "c"]);
  });

  it("dedups repeats and keeps the first slot", () => {
    const ix = buildGlyphIndex("aabca");
    expect(ix.byGlyph.get("a")).toBe(1);
    expect(ix.slots).toEqual([TOFU_GLYPH, "a", "b", "c"]);
  });

  it("iterates by code point — a multi-unit glyph is one slot", () => {
    // Box-drawing + arrows are multi-byte; iterate as whole code points, not units.
    const ix = buildGlyphIndex("─│→↗");
    expect(ix.slots).toEqual([TOFU_GLYPH, "─", "│", "→", "↗"]);
    expect(ix.byGlyph.get("↗")).toBe(4);
  });

  it("includes space as a real slot (drawn as a transparent cell)", () => {
    const ix = buildGlyphIndex(" #");
    expect(ix.byGlyph.get(" ")).toBe(1);
    expect(ix.byGlyph.get("#")).toBe(2);
  });

  it("warns and drops a glyph past atlas capacity (never silently overwrites)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // capacity - 1 unique glyphs fit (slot 0 is tofu); one more overflows.
      const capacity = ATLAS_COLS * ATLAS_ROWS;
      const glyphs = Array.from({ length: capacity }, (_, i) => String.fromCodePoint(0x100 + i)).join("");
      const ix = buildGlyphIndex(glyphs);
      expect(ix.slots.length).toBe(capacity); // filled exactly, last glyph dropped
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("slotCell", () => {
  it("maps a slot to its (col,row) atlas cell", () => {
    expect(slotCell(0)).toEqual([0, 0]);
    expect(slotCell(1)).toEqual([1, 0]);
    expect(slotCell(ATLAS_COLS)).toEqual([0, 1]); // wraps to the next atlas row
    expect(slotCell(ATLAS_COLS + 3)).toEqual([3, 1]);
  });
});
