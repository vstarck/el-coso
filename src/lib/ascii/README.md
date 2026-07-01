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
- `renderer.ts` — the **`SurfaceRenderer` seam** for per-frame lenses: a
  stateful renderer object that OWNS the canvas context (caller passes a bare
  `<canvas>`, never calls `getContext`) so alternate backends — Canvas2D now,
  WebGL later — swap behind one interface with no upstream change.
  `makeCanvasTextRenderer` wraps the `fillText` path (baseline).
- `canvas-atlas-backend.ts` — `makeCanvasAtlasRenderer`: the perf backend.
  Rasterizes each glyph once and blits it (no `fillText` in steady state), with
  two wins for large moving grids: a **quantized-colour tile cache** (fg snapped
  to 32 levels/ch so a moving camera's shading still cache-hits) and a **strip
  blit** — the glyph pass is column-major, so a uniform vertical run (a raycaster
  wall column) draws in ONE `drawImage` from a full-column strip tile via a
  source sub-rect (Wolfenstein's scaled texture-column, GPU-scaled). Pure helpers
  `parseCssColor` / `quantizeChannel` are exported + unit-tested.

**Purity rule:** the render is write-only. Backends attach no input
handlers to cells; player input arrives via keyboard or a sibling control
surface, never per-cell DOM event targets.

Consumers: `blockoide` renders its well + NEXT preview through `renderToPre`
(a supersampled small-font `<pre>`). The **canvas** backends drive the ASCII
raycasters `tfps` and `nm5` (`@/lib/raycast` → `Surface` → canvas); nm5 uses
`makeCanvasAtlasRenderer` (strip-blit) for Full-HD-scale grids at 60fps. An
ANSI / terminal backend is designed-not-shipped — the IR is backend-agnostic,
adding one touches no lens.
