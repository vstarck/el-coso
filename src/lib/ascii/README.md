# `src/lib/ascii/` — ASCII render kit

**Chrome-tier. May import DOM. Not translatable.**

The render path for `target_kind: "ascii"` lenses. A lens builds a
pure-data **styled cell buffer** (`Surface`); a **backend** materializes
it for a concrete output.

- `surface.ts` — the IR (`Surface`, `Cell`) + `makeSurface` / `put` /
  `writeText`.
- `dictionary.ts` — role→glyph `GlyphSet` + `rampGlyph` (ramp sampling),
  so the glyph set is overridable data.
- `html-backend.ts` — `renderToPre(surface, pre)`: full rewrite,
  same-style runs coalesce into spans, glyphs escaped, no listeners.
- `canvas-backend.ts` — `renderToCanvas(surface, canvas, opts?)`: each cell
  an exact square (fill or glyph). The backend for a fine supersampled grid
  scaled into a fixed box, where `<pre>` glyphs would be sub-readable.

**Purity rule:** the render is write-only. Backends attach no input
handlers to cells; player input arrives via keyboard or a sibling control
surface, never per-cell DOM event targets.

Consumer: `blockoide` — both its well (a supersampled small-font `<pre>`,
each game cell a block of legible characters) and its NEXT preview go
through `renderToPre`. The canvas backend is the IR's second materializer
(the seam that justifies the IR/backend split); it has no lens consumer
today. An ANSI / terminal backend is designed-not-shipped — the IR is
backend-agnostic, adding one touches no lens.
