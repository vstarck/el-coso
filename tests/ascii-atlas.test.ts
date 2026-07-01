/* Glyph-atlas colour helpers (S117) — the pure logic behind the atlas backend's
 * cross-frame cache. The render loop itself needs a canvas (verified in-browser
 * via ?profile); these are the parts that must be exactly right for the cache to
 * warm (parse every colour nm5 emits; quantize stably).
 */
import { describe, it, expect } from "vitest";
import {
  parseCssColor,
  quantizeChannel,
  makeCanvasAtlasRenderer,
  makeSurface,
  type Surface,
} from "../src/lib/ascii";

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

// A no-op 2D context — enough for the atlas to run its passes without a real
// canvas (the drawing is verified in-browser; here we only assert the cache
// bookkeeping that stats() exposes).
function fakeCtx(): CanvasRenderingContext2D {
  return new Proxy(
    { fillStyle: "", font: "", textAlign: "", textBaseline: "" },
    { get: (t, k) => (k in t ? (t as never)[k] : () => {}), set: () => true },
  ) as unknown as CanvasRenderingContext2D;
}
function fakeCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0, getContext: () => fakeCtx() } as unknown as HTMLCanvasElement;
}
// Fill each column with a distinct fg colour glyph so a render mints one strip +
// one colour-key per column (a single vertical run each).
function surfaceWithColumnColours(colours: string[]): Surface {
  const s = makeSurface(colours.length, 3);
  for (let x = 0; x < colours.length; x++) {
    const fg = colours[x]!;
    for (let y = 0; y < s.h; y++) s.cells[y * s.w + x] = { glyph: "#", fg };
  }
  return s;
}

describe("atlas stats() — cache bookkeeping (the profile readout's source)", () => {
  const g = globalThis as { OffscreenCanvas?: unknown };

  it("reports live strip + colour-key sizes; grows with DISTINCT colours, holds on repeats", () => {
    // Atlas tiles use `new OffscreenCanvas`; absent under node, stub it.
    const had = "OffscreenCanvas" in g;
    if (!had) g.OffscreenCanvas = class {
      constructor() {
        return fakeCanvas();
      }
    };
    try {
      const r = makeCanvasAtlasRenderer(fakeCanvas(), { width: 40, height: 30 });
      expect(r.stats?.()).toEqual({ blitCalls: 0, strips: 0, colourKeys: 0 });

      r.render(surfaceWithColumnColours(["#ff0000", "#00ff00", "#0000ff"]));
      const first = r.stats!();
      expect(first.colourKeys).toBe(3); // one distinct fg per column
      expect(first.strips).toBe(3);
      // Each column is ONE uniform vertical run → one blit per column (the clean
      // best case). Fragmentation would push this toward one blit per cell.
      expect(first.blitCalls).toBe(3);

      // Re-render the SAME colours → the raw-string memo hits, nothing grows.
      r.render(surfaceWithColumnColours(["#ff0000", "#00ff00", "#0000ff"]));
      expect(r.stats!().colourKeys).toBe(3);

      // NEW distinct colours (the per-tick shimmer case) → the memo grows — the
      // tell the `profile` command surfaces (climbs forever without a bounded palette).
      r.render(surfaceWithColumnColours(["#111111", "#222222", "#333333"]));
      expect(r.stats!().colourKeys).toBe(6);

      r.dispose();
      expect(r.stats!()).toEqual({ blitCalls: 0, strips: 0, colourKeys: 0 }); // dispose clears
    } finally {
      if (!had) delete g.OffscreenCanvas;
    }
  });

  it("blitCalls exposes fragmentation: clean columns ≪ per-cell noise", () => {
    const had = "OffscreenCanvas" in g;
    if (!had) g.OffscreenCanvas = class {
      constructor() {
        return fakeCanvas();
      }
    };
    try {
      const r = makeCanvasAtlasRenderer(fakeCanvas(), { width: 60, height: 60 });

      // 6×6 clean: each column one uniform run → 6 blits (best case).
      const clean = makeSurface(6, 6);
      for (let x = 0; x < 6; x++)
        for (let y = 0; y < 6; y++) clean.cells[y * 6 + x] = { glyph: "#", fg: "#8080ff" };
      r.render(clean);
      expect(r.stats!().blitCalls).toBe(6);

      // 6×6 per-cell distinct colour (nm5's corruption shimmer) → runs shatter to
      // length 1 → 36 blits, one per cell. This 6× jump is the blit wall.
      const noisy = makeSurface(6, 6);
      for (let x = 0; x < 6; x++)
        for (let y = 0; y < 6; y++)
          noisy.cells[y * 6 + x] = { glyph: "#", fg: `rgb(${x * 30},${y * 30},${x * y})` };
      r.render(noisy);
      expect(r.stats!().blitCalls).toBe(36);

      r.dispose();
    } finally {
      if (!had) delete g.OffscreenCanvas;
    }
  });
});
