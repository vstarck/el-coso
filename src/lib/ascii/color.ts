/* Shared colour parsing for the ascii render backends.
 *
 * Both the Canvas2D atlas and the WebGL2 backend need to turn a Cell's CSS
 * colour string into numeric channels — the atlas to quantize it into a stable
 * strip-cache key, the GL backend to upload it as a per-instance tint. This used
 * to live in canvas-atlas-backend.ts with the GL backend importing it from there
 * (a backend depending on a sibling backend); it lives here so both import from a
 * neutral spot.
 */

// Parse "rgb(r,g,b)" / "rgba(...)" / "#rgb" / "#rrggbb" → [r,g,b] 0–255. Bad
// input falls back to white (never throws — a colour glitch must not kill render).
export function parseCssColor(s: string): [number, number, number] {
  if (!s) return [255, 255, 255];
  if (s.charCodeAt(0) === 35 /* '#' */) {
    const h = s.slice(1);
    const wide = h.length >= 6;
    const r = parseInt(wide ? h.slice(0, 2) : h[0]! + h[0]!, 16);
    const g = parseInt(wide ? h.slice(2, 4) : h[1]! + h[1]!, 16);
    const b = parseInt(wide ? h.slice(4, 6) : h[2]! + h[2]!, 16);
    return [r || 0, g || 0, b || 0];
  }
  const open = s.indexOf("(");
  const close = s.indexOf(")");
  if (open < 0 || close < 0) return [255, 255, 255];
  const p = s.slice(open + 1, close).split(",");
  const n = (i: number): number => {
    const v = parseInt(p[i] ?? "", 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(255, v)) : 0;
  };
  return [n(0), n(1), n(2)];
}

const QUANT_STEP = 8; // 256/8 = 32 levels/channel

// Snap a channel to `step` levels so continuous shading buckets into a stable
// palette (strip cache hits across frames).
export function quantizeChannel(v: number, step: number = QUANT_STEP): number {
  const q = Math.round(v / step) * step;
  return q < 0 ? 0 : q > 255 ? 255 : q;
}
