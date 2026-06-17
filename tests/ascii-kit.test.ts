import { expect, test } from "vitest";
import {
  makeSurface,
  put,
  writeText,
  rampGlyph,
  renderToPre,
  renderToCanvas,
  type Surface,
} from "../src/lib/ascii";

// ASCII render kit: the styled cell buffer is pure data, and the
// HTML backend materializes it with coalesced style runs, escaped glyphs,
// and — the load-bearing purity criterion — no data-* attribute and no
// event handler on any rendered element.

test("makeSurface allocates w*h independent cells", () => {
  const s = makeSurface(3, 2);
  expect(s.cells.length).toBe(6);
  s.cells[0]!.glyph = "X";
  expect(s.cells[1]!.glyph).toBe(" "); // fill copies, not aliases
});

test("put clips out of bounds; writeText lays a run", () => {
  const s = makeSurface(4, 1);
  put(s, -1, 0, { glyph: "Z" }); // no throw, no effect
  put(s, 9, 0, { glyph: "Z" });
  writeText(s, 1, 0, "ab", { fg: "#f00" });
  expect(s.cells.map((c) => c.glyph).join("")).toBe(" ab ");
  expect(s.cells[1]!.fg).toBe("#f00");
});

test("rampGlyph: single glyph ignores t; a ramp samples and clamps", () => {
  expect(rampGlyph("#", 0.7)).toBe("#");
  const ramp = ["a", "b", "c", "d"];
  expect(rampGlyph(ramp, 0)).toBe("a");
  expect(rampGlyph(ramp, 1)).toBe("d");
  expect(rampGlyph(ramp, -5)).toBe("a"); // clamp low
  expect(rampGlyph(ramp, 5)).toBe("d"); // clamp high
});

function fakePre(): HTMLPreElement {
  return { innerHTML: "" } as unknown as HTMLPreElement;
}

test("renderToPre: text content is glyphs row-major", () => {
  const s = makeSurface(2, 2);
  put(s, 0, 0, { glyph: "a" });
  put(s, 1, 0, { glyph: "b" });
  put(s, 0, 1, { glyph: "c" });
  put(s, 1, 1, { glyph: "d" });
  const pre = fakePre();
  renderToPre(s, pre);
  // strip spans → plain text
  const text = pre.innerHTML.replace(/<[^>]+>/g, "");
  expect(text).toBe("ab\ncd");
});

test("renderToPre coalesces same-style runs and never emits behavior", () => {
  const s = makeSurface(4, 1);
  put(s, 0, 0, { glyph: "X", fg: "#f00" });
  put(s, 1, 0, { glyph: "Y", fg: "#f00" }); // same style → one span with XY
  put(s, 2, 0, { glyph: "Z", fg: "#0f0" }); // different → its own span
  put(s, 3, 0, { glyph: "." }); // default → raw, no span
  const pre = fakePre();
  renderToPre(s, pre);
  const html = pre.innerHTML;
  // exactly two spans (the two colored runs); the default cell is raw.
  expect((html.match(/<span/g) ?? []).length).toBe(2);
  expect(html).toContain(">XY</span>"); // coalesced
  // purity: no interactivity smuggled into the render.
  expect(html).not.toMatch(/data-/);
  expect(html).not.toMatch(/onclick/i);
});

test("renderToPre escapes HTML-significant glyphs", () => {
  const s: Surface = makeSurface(3, 1);
  put(s, 0, 0, { glyph: "<" });
  put(s, 1, 0, { glyph: ">" });
  put(s, 2, 0, { glyph: "&" });
  const pre = fakePre();
  renderToPre(s, pre);
  expect(pre.innerHTML).toBe("&lt;&gt;&amp;");
});

function fakeCanvas(w: number, h: number) {
  const calls: { fillRect: unknown[][]; fillText: unknown[][] } = {
    fillRect: [],
    fillText: [],
  };
  let fs = "";
  const ctx = {
    set fillStyle(v: string) {
      fs = v;
    },
    get fillStyle() {
      return fs;
    },
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set globalAlpha(_v: number) {},
    clearRect() {},
    fillRect(...a: unknown[]) {
      calls.fillRect.push([...a, fs]);
    },
    fillText(...a: unknown[]) {
      calls.fillText.push([...a, fs]);
    },
  };
  const canvas = { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

test("renderToCanvas fills the background then a square per inked cell", () => {
  const s = makeSurface(2, 2);
  put(s, 0, 0, { glyph: "█", fg: "#abcdef" }); // inked
  // the other three cells stay " " (space) → no ink
  const { canvas, calls } = fakeCanvas(20, 20);
  renderToCanvas(s, canvas, { background: "#000000" });
  // one background fill + exactly one inked cell
  expect(calls.fillRect.length).toBe(2);
  expect(calls.fillRect[0]).toEqual([0, 0, 20, 20, "#000000"]); // full-canvas bg
  // the inked square carries the cell's fg color
  expect(calls.fillRect[1]![4]).toBe("#abcdef");
  expect(calls.fillText.length).toBe(0); // square mode, no glyphs
});

test("renderToCanvas draws glyphs when asked", () => {
  const s = makeSurface(1, 1);
  put(s, 0, 0, { glyph: "X", fg: "#fff" });
  const { canvas, calls } = fakeCanvas(40, 40);
  renderToCanvas(s, canvas, { drawGlyphs: true });
  expect(calls.fillText.length).toBe(1);
  expect(calls.fillText[0]![0]).toBe("X");
  expect(calls.fillRect.length).toBe(0); // no square fill in glyph mode (no bg)
});
