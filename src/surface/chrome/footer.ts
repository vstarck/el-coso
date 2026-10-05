/* The credits footer, DRAWN — moved from swarm-swart-grid (S242) into el-coso at S248 (spec/32 §5.1). It ships NO
 * portfolio data: the QR matrix, the caption and the sources are the caller's (the QR size is a parameter).
 *
 * Origin (S242, the owner: "render the footer as canvas, so it's part of the rendered image"; then
 * the layout from the owner's reference — a sources list on the left, a QR code to the portfolio on the right, "flexed
 * 4:1 or whatever allows the qr and link to render and leave the rest of the space to the left").
 *
 * The footer is a strip of the main canvas below the render, so the canvas the host snapshots and the PNG the download
 * button saves both carry it. NOTHING in it is a link (the owner: "clickable links will be rendered beside the post in
 * the host html") — it is ink only. The layout is pure (a measure function is injected: node tests pass a fake one) and
 * is computed in CSS px, so the 2× export draws the SAME composition at twice the resolution. It is painted once per
 * canvas size, never per frame: a frame's putImageData covers the render region only.
 */

const PAD = 12, PAD_Y = 15; // sides; top and bottom (the owner, S242: "slightly bigger")
/** QR: CSS px per module (an integer, so the modules land on whole pixels at 1× and 2×) and its light margin in CSS px
 *  (the owner: one px less than the 2 modules it was; the corners rounded) */
export const QR_MODULE = 3, QR_QUIET_PX = 5;
const QR_RADIUS = 4;
const qrBox = (qrSize: number): number => qrSize * QR_MODULE + 2 * QR_QUIET_PX;
const CAPTION_GAP = 5, CAPTION_H = 15;
/** The footer's FIXED height (CSS px), DERIVED from the QR column — the tallest thing in it: part of the embed's
 *  natural size (the substrate's `meta.renderSize`). Sources that do not fit are clipped and counted, never reflowed. */
export function footerHeight(qrSize: number): number {
  if (!Number.isInteger(qrSize) || qrSize < 21) throw new Error(`footer: a QR is at least 21 modules (got ${qrSize})`);
  return PAD_Y + qrBox(qrSize) + CAPTION_GAP + CAPTION_H + PAD_Y;
}
/** A QR code: its URL and its module matrix ("0"/"1" rows, square). */
export type Qr = { url: string; rows: readonly string[] };

const GUTTER = 18; // between the sources and the QR column
const HEAD_H = 17, HEAD_GAP = 9; // "SOURCES"
const COL_GAP = 14, ROW_H = 30, ROW_GAP = 8, TILE = 30, TILE_GAP = 8, DETAIL_DY = 16;

export const FONT = {
  head: "400 13px system-ui, -apple-system, sans-serif",
  title: "700 12px system-ui, -apple-system, sans-serif",
  detail: "400 12px system-ui, -apple-system, sans-serif",
  mark: "700 15px system-ui, -apple-system, sans-serif",
  caption: "400 12px system-ui, -apple-system, sans-serif",
} as const;
type FontKind = keyof typeof FONT;
const COLOUR = { bg: "#000", rule: "rgba(255,255,255,.1)", head: "#a39d92", title: "#e7e2d8", detail: "#8f897f", mark: "#f2eee6", caption: "#c9c2b6", qrDark: "#000", qrLight: "#fff" };

/** A vector mark for a tile: an SVG path `d` in a `box` × `box` viewBox, filled with `ink` on the tile's tint. */
export type Glyph = { d: string; box: number; ink: string };
/** One source: an icon (the picture itself, else a vector glyph, else a monogram — each on the tint), an UPPERCASE
 *  title, a detail line (a credit, a licence, an address — never a link). The icon is any square image; the tile draws
 *  it scaled and rounded. */
export type Source = { mark: string; tint: string; title: string; detail: string; icon?: CanvasImageSource; glyph?: Glyph };
export type FooterText = { text: string; font: FontKind; colour: string; x: number; y: number };
export type FooterTile = { mark: string; tint: string; icon?: CanvasImageSource; glyph?: Glyph; x: number; y: number; size: number };
export type FooterLayout = {
  width: number;
  height: number;
  texts: FooterText[];
  tiles: FooterTile[];
  /** the QR's top-left (its light margin's), module size and margin — CSS px */
  qr: { x: number; y: number; module: number; quiet: number; size: number };
  /** texts shortened with an ellipsis to fit their column, and sources dropped for want of height */
  truncated: number;
  clipped: number;
};

export function layoutFooter(measure: (s: string, font: string) => number, width: number, sources: Source[], caption: string, qrSize: number): FooterLayout {
  const QR_BOX = qrBox(qrSize), FOOTER_H = footerHeight(qrSize);
  const texts: FooterText[] = [], tiles: FooterTile[] = [];
  let truncated = 0;
  const fit = (s: string, font: FontKind, maxW: number): string => {
    if (measure(s, FONT[font]) <= maxW) return s;
    truncated++;
    let t = s;
    while (t.length > 0 && measure(t + "…", FONT[font]) > maxW) t = t.slice(0, -1);
    return t + "…";
  };

  // right: the QR column, as wide as the QR or its caption, whichever is wider
  const rightW = Math.ceil(Math.max(QR_BOX, measure(caption, FONT.caption)));
  const rightX = width - PAD - rightW;
  const qr = { x: Math.round(rightX + (rightW - QR_BOX) / 2), y: PAD_Y, module: QR_MODULE, quiet: QR_QUIET_PX, size: qrSize };
  const capW = measure(caption, FONT.caption);
  texts.push({ text: caption, font: "caption", colour: COLOUR.caption, x: rightX + (rightW - capW) / 2, y: PAD_Y + QR_BOX + CAPTION_GAP });

  // left: the rest — a heading, then the sources in two columns, row by row. Each column is as wide as its widest
  // text needs, and the spare is shared; when they do not both fit, they share the width in proportion to their need
  // (and whatever still overflows gets an ellipsis, counted).
  const leftW = Math.max(0, rightX - GUTTER - PAD);
  texts.push({ text: "SOURCES", font: "head", colour: COLOUR.head, x: PAD, y: PAD_Y });
  const top = PAD_Y + HEAD_H + HEAD_GAP, rowsFit = Math.max(0, Math.floor((FOOTER_H - PAD_Y - top + ROW_GAP) / (ROW_H + ROW_GAP)));
  const shown = sources.slice(0, rowsFit * 2);
  const need = [0, 1].map((col) => TILE + TILE_GAP + Math.max(0, ...shown.filter((_, i) => i % 2 === col)
    .flatMap((s) => [measure(s.title.toUpperCase(), FONT.title), measure(s.detail, FONT.detail)])));
  const avail = leftW - COL_GAP, spare = avail - need[0]! - need[1]!;
  const col0 = spare >= 0 ? need[0]! + spare / 2 : (avail * need[0]!) / (need[0]! + need[1]!);
  const colW = [col0, avail - col0];
  shown.forEach((s, i) => {
    const col = i % 2, x = PAD + (col ? colW[0]! + COL_GAP : 0), y = top + Math.floor(i / 2) * (ROW_H + ROW_GAP);
    const textW = colW[col]! - TILE - TILE_GAP;
    tiles.push({ mark: s.mark, tint: s.tint, ...(s.icon ? { icon: s.icon } : {}), ...(s.glyph ? { glyph: s.glyph } : {}), x, y, size: TILE });
    texts.push({ text: fit(s.title.toUpperCase(), "title", textW), font: "title", colour: COLOUR.title, x: x + TILE + TILE_GAP, y: y + 1 });
    texts.push({ text: fit(s.detail, "detail", textW), font: "detail", colour: COLOUR.detail, x: x + TILE + TILE_GAP, y: y + DETAIL_DY });
  });
  return { width, height: FOOTER_H, texts, tiles, qr, truncated, clipped: sources.length - shown.length };
}

/** Paint the footer into `ctx` with its top at canvas-pixel row `y0`, at `k` canvas pixels per CSS px. Clipped to its
 *  own strip. Leaves the context's state as it found it. */
export function drawFooter(ctx: CanvasRenderingContext2D, lay: FooterLayout, y0: number, k: number, qrRows: readonly string[]): void {
  if (qrRows.length !== lay.qr.size) throw new Error(`footer: laid out for a ${lay.qr.size}² QR, drawing a ${qrRows.length}²`);
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, y0);
  ctx.fillStyle = COLOUR.bg;
  ctx.fillRect(0, 0, lay.width, lay.height);
  ctx.beginPath();
  ctx.rect(0, 0, lay.width, lay.height);
  ctx.clip();
  ctx.fillStyle = COLOUR.rule;
  ctx.fillRect(0, 0, lay.width, 1 / k); // a hairline between the render and the footer

  for (const t of lay.tiles) {
    if (t.icon) { // the picture itself, rounded
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(t.x, t.y, t.size, t.size, 5);
      ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(t.icon, t.x, t.y, t.size, t.size);
      ctx.restore();
      continue;
    }
    ctx.fillStyle = t.tint;
    ctx.beginPath();
    ctx.roundRect(t.x, t.y, t.size, t.size, 5);
    ctx.fill();
    if (t.glyph) { // a vector mark, inset by a sixth of the tile
      const inset = t.size / 6, sc = (t.size - 2 * inset) / t.glyph.box;
      ctx.save();
      ctx.translate(t.x + inset, t.y + inset);
      ctx.scale(sc, sc);
      ctx.fillStyle = t.glyph.ink;
      ctx.fill(new Path2D(t.glyph.d));
      ctx.restore();
      continue;
    }
    ctx.font = FONT.mark;
    ctx.fillStyle = COLOUR.mark;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.mark, t.x + t.size / 2, t.y + t.size / 2 + 0.5);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const t of lay.texts) {
    ctx.font = FONT[t.font];
    ctx.fillStyle = t.colour;
    ctx.fillText(t.text, t.x, t.y);
  }

  // the QR: a light margin with rounded corners, then one square per dark module
  const { x, y, module: m, quiet } = lay.qr, n = qrRows.length;
  ctx.fillStyle = COLOUR.qrLight;
  ctx.beginPath();
  ctx.roundRect(x, y, n * m + 2 * quiet, n * m + 2 * quiet, QR_RADIUS);
  ctx.fill();
  ctx.fillStyle = COLOUR.qrDark;
  for (let r = 0; r < n; r++) {
    const row = qrRows[r]!;
    for (let c = 0; c < n; c++) if (row[c] === "1") ctx.fillRect(x + quiet + c * m, y + quiet + r * m, m, m);
  }
  ctx.restore();
}
