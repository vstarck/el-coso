// ASCII render kit — the styled cell-buffer IR + a glyph
// dictionary + backends. Chrome-tier; may import DOM; not translatable.

export { makeSurface, put, writeText, type Cell, type Surface } from "./surface";
export { rampGlyph, type GlyphEntry, type GlyphSet } from "./dictionary";
export { renderToPre } from "./html-backend";
export { renderToCanvas, type CanvasRenderOpts } from "./canvas-backend";
export {
  makeCanvasTextRenderer,
  makeCanvasAtlasRenderer,
  makeGlRenderer,
  type SurfaceRenderer,
  type SurfaceRendererFactory,
  type SurfaceRendererOpts,
} from "./renderer";
export { parseCssColor, quantizeChannel } from "./canvas-atlas-backend";
export { buildGlyphIndex, slotCell, TOFU_GLYPH, ATLAS_COLS, ATLAS_ROWS } from "./gl-backend";
