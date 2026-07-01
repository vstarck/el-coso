/* Glyph-atlas colour helpers (S117) — the pure logic behind the atlas backend's
 * cross-frame cache. The render loop itself needs a canvas (verified in-browser
 * via ?profile); these are the parts that must be exactly right for the cache to
 * warm (parse every colour nm5 emits; quantize stably).
 */
import { describe, it, expect } from "vitest";
import { parseCssColor, quantizeChannel } from "../src/lib/ascii";

describe("parseCssColor", () => {
  it("parses rgb()", () => {
    expect(parseCssColor("rgb(10,20,30)")).toEqual([10, 20, 30]);
    expect(parseCssColor("rgb(255, 128, 0)")).toEqual([255, 128, 0]);
  });
  it("parses rgba() (drops alpha)", () => {
    expect(parseCssColor("rgba(10,20,30,0.5)")).toEqual([10, 20, 30]);
  });
  it("parses #rrggbb and #rgb", () => {
    expect(parseCssColor("#ff2bd6")).toEqual([255, 43, 214]);
    expect(parseCssColor("#0a0")).toEqual([0, 170, 0]);
  });
  it("clamps and never throws on garbage", () => {
    expect(parseCssColor("")).toEqual([255, 255, 255]);
    expect(parseCssColor("nonsense")).toEqual([255, 255, 255]);
    expect(parseCssColor("rgb(999,-5,20)")).toEqual([255, 0, 20]);
  });
});

describe("quantizeChannel", () => {
  it("snaps to a bounded grid (stable across nearby inputs)", () => {
    // Values within a step round to the same bucket → cross-frame cache hits.
    expect(quantizeChannel(100)).toBe(quantizeChannel(101));
    expect(quantizeChannel(100)).toBe(quantizeChannel(103));
    expect(quantizeChannel(100)).not.toBe(quantizeChannel(112));
  });
  it("stays in range and is idempotent", () => {
    for (const v of [0, 3, 4, 127, 128, 251, 255]) {
      const q = quantizeChannel(v);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(255);
      expect(quantizeChannel(q)).toBe(q);
    }
  });
});
