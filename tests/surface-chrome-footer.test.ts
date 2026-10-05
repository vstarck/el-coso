/* Moved from swarm-swart-grid (S242) into el-coso at S248 (spec/32 §5.1); the QR size is now a parameter.
 * S242 — the drawn footer's layout (pure; the drawing is covered by the mount smoke, which reads the QR back off the
 * canvas). Every number below is hand-derived with a fake measure of 6 px per character, whatever the font:
 *   the QR box = 29 modules × 3 px + 2 × 5 px margin = 97; the strip = 15 + 97 + 5 + 15 + 15 = 147;
 *   at 640 wide the caption "valentin.starck.im" (18 chars = 108 px) is wider than the QR, so the QR column is 108 px
 *   at x = 640 − 12 − 108 = 520, the QR centred in it at round(520 + 5.5) = 526, y 15, the caption at y 15 + 97 + 5;
 *   the sources get 520 − 18 − 12 = 490 px, 476 after the 14 px column gap;
 *   rows start at 15 + 17 + 9 = 41, every 30 + 8 = 38 px, and floor((147 − 15 − 41 + 8) / 38) = 2 rows fit;
 *   a column needs 30 (tile) + 8 + its widest text; the spare is shared equally, a shortfall in proportion to need. */
import { describe, expect, test } from "vitest";
import { drawFooter, footerHeight, layoutFooter, type Source } from "@/surface/chrome/footer";

const QR_SIZE = 29; // the portfolio's baked matrix (la-cosa dev/bake-qr.mjs, v3 29²) — the derivation's input

const measure = (s: string) => 6 * s.length;
const src = (title: string, detail = "d"): Source => ({ mark: "X", tint: "#333", title, detail });
const CAPTION = "valentin.starck.im";

describe("footer layout", () => {
  test("the strip's height is derived from the QR column: 147 px", () => {
    expect(footerHeight(QR_SIZE)).toBe(147);
  });

  test("the QR column on the right, as wide as its caption; short sources share the spare equally (44 + 194 = 238)", () => {
    const lay = layoutFooter(measure, 640, [src("a"), src("b"), src("c")], CAPTION, QR_SIZE);
    expect(lay.qr).toEqual({ x: 526, y: 15, module: 3, quiet: 5, size: 29 });
    expect(lay.texts.find((t) => t.font === "caption")).toMatchObject({ text: CAPTION, x: 520, y: 117 });
    expect(lay.texts.find((t) => t.font === "head")).toMatchObject({ text: "SOURCES", x: 12, y: 15 });
    expect(lay.tiles.map((t) => [t.x, t.y, t.size])).toEqual([[12, 41, 30], [264, 41, 30], [12, 79, 30]]);
    const titles = lay.texts.filter((t) => t.font === "title").map((t) => [t.text, t.x, t.y]);
    expect(titles).toEqual([["A", 50, 42], ["B", 302, 42], ["C", 50, 80]]); // uppercased
    expect([lay.truncated, lay.clipped]).toEqual([0, 0]);
  });

  test("nothing on the left reaches the QR column's gutter (520 − 18 = 502)", () => {
    const lay = layoutFooter(measure, 640, [src("x".repeat(33), "y".repeat(33)), src("z".repeat(33))], CAPTION, QR_SIZE);
    for (const t of lay.texts.filter((t) => t.font !== "caption")) expect(t.x + measure(t.text)).toBeLessThanOrEqual(502);
    expect(lay.truncated).toBe(0); // 38 + 198 = 236 each: they fit, with 4 px to spare
  });

  test("columns follow their content: a shortfall is shared in proportion to need (398 : 218 of 476)", () => {
    const lay = layoutFooter(measure, 640, [src("t", "q".repeat(60)), src("u", "r".repeat(30))], CAPTION, QR_SIZE);
    const col0 = (476 * 398) / 616;
    expect(lay.tiles[1]!.x).toBeCloseTo(12 + col0 + 14, 9);
    const details = lay.texts.filter((t) => t.font === "detail").map((t) => t.text);
    // col 0 text: col0 − 38 = 269.5 px ⇒ 43 chars + … (44 × 6 = 264); col 1: 476 − col0 − 38 = 130.5 ⇒ 20 + … (126)
    expect(details).toEqual(["q".repeat(43) + "…", "r".repeat(20) + "…"]);
    expect(lay.truncated).toBe(2); // counted, never silent
  });

  test("too many ⇒ the fifth source is dropped and COUNTED (2 rows × 2 fit), never reflowed", () => {
    const lay = layoutFooter(measure, 640, ["a", "b", "c", "d", "e"].map((t) => src(t)), CAPTION, QR_SIZE);
    expect([lay.tiles.length, lay.clipped]).toEqual([4, 1]);
  });
});

describe("footer refusals (S248)", () => {
  test("a QR drawn into a layout made for another size is refused", () => {
    const lay = layoutFooter(measure, 640, [src("a")], CAPTION, QR_SIZE);
    const ctx = { save() {}, restore() {} } as unknown as CanvasRenderingContext2D;
    expect(() => drawFooter(ctx, lay, 0, 1, Array(25).fill("0".repeat(25)))).toThrow(/laid out for a 29² QR, drawing a 25²/);
  });
  test("a QR smaller than 21 modules is refused", () => {
    expect(() => footerHeight(20)).toThrow(/at least 21 modules \(got 20\)/);
  });
});
