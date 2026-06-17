/* Canvas paint adapter for HistoryViewState — the non-SVG sibling of
 * TimelineTree, for substrate in-HUD histories. Pure draw: takes a 2D context
 * and a laid-out HistoryViewState (already projected, any orientation) and
 * paints it. Glyphs render compactly in the lens vocabulary (disc / char /
 * circle / arrow + count for folds); `image` glyphs fall back to a dot since
 * portraits aren't legible at HUD scale (refine later if wanted).
 *
 * App-tier (throwaway / not translated). Lives beside historyLayout so any
 * lens that wants an embedded history calls `layoutHistory(...)` then this.
 */

import type { HistoryViewState } from "./historyLayout";
import type { CommitGlyph } from "@/lenses/types";
import type { Params } from "./types";

export type HistoryCanvasOpts = {
  // Resolve a node's glyph from its payload (the lens's own commitGlyph).
  glyphOf?: (params: Params) => CommitGlyph;
  fg?: string; // commit text / default node
  muted?: string; // baselines, count text
  accent?: string; // playhead
  pill?: string; // fold-capsule background
  nodeR?: number; // base node radius
};

const DEFAULTS = {
  fg: "rgba(255,255,255,0.85)",
  muted: "rgba(255,255,255,0.4)",
  accent: "#fbbf24",
  pill: "rgba(20,22,28,0.92)",
  nodeR: 4,
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // ctx.roundRect exists in modern browsers; fall back for safety.
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: CommitGlyph,
  x: number,
  y: number,
  r: number,
  o: typeof DEFAULTS,
): void {
  switch (glyph.kind) {
    case "disc":
      ctx.fillStyle = glyph.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "char":
      ctx.fillStyle = o.fg;
      ctx.font = `${r * 2}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph.char, x, y);
      break;
    case "arrow": {
      ctx.fillStyle = glyph.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // tiny white triangle pointing `dir`
      const a = { up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI }[glyph.dir];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(r * 0.6, 0);
      ctx.lineTo(-r * 0.3, -r * 0.45);
      ctx.lineTo(-r * 0.3, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case "circle":
    case "svg":
    case "image":
    default:
      ctx.fillStyle = o.muted;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

export function paintHistory(
  ctx: CanvasRenderingContext2D,
  vs: HistoryViewState,
  opts: HistoryCanvasOpts = {},
): void {
  const o = { ...DEFAULTS, ...opts };
  ctx.save();

  // Baselines + branch curves.
  for (const e of vs.edges) {
    ctx.strokeStyle = o.muted;
    ctx.globalAlpha = e.kind === "baseline" ? e.opacity : 0.5;
    ctx.lineWidth = e.kind === "baseline" ? e.width : 1.25;
    ctx.beginPath();
    if (e.kind === "baseline") {
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    } else {
      ctx.moveTo(e.from.x, e.from.y);
      ctx.bezierCurveTo(e.c1.x, e.c1.y, e.c2.x, e.c2.y, e.to.x, e.to.y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Nodes.
  for (const n of vs.nodes) {
    const { x, y } = n.at;
    if (n.kind === "fork-echo") {
      ctx.globalAlpha = 0.35;
      const g = o.glyphOf && n.params ? o.glyphOf(n.params) : { kind: "circle" as const };
      drawGlyph(ctx, g, x, y, o.nodeR, o);
      ctx.globalAlpha = 1;
      continue;
    }
    if (n.kind === "fold") {
      const label = String(n.count ?? 0);
      const glyph = n.homogeneous && n.params && o.glyphOf ? o.glyphOf(n.params) : null;
      ctx.font = "9px ui-monospace, monospace";
      const countW = ctx.measureText(label).width;
      const iconW = glyph ? o.nodeR * 2 + 4 : 0;
      const w = 8 + countW + iconW + 6;
      const h = 15;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
      ctx.fillStyle = o.pill;
      ctx.fill();
      ctx.strokeStyle = o.muted;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = o.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x - w / 2 + 6, y + 0.5);
      if (glyph) drawGlyph(ctx, glyph, x + w / 2 - o.nodeR - 5, y, o.nodeR, o);
      continue;
    }
    // commit
    const glyph: CommitGlyph =
      o.glyphOf && n.params ? o.glyphOf(n.params) : { kind: "circle" };
    const r = n.isHead ? o.nodeR + 2 : o.nodeR;
    if (n.isHead) {
      ctx.strokeStyle = o.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawGlyph(ctx, glyph, x, y, r, o);
  }

  // Playhead (and scrub) cursors — a line across the cross extent.
  for (const c of vs.cursors) {
    ctx.strokeStyle = o.accent;
    ctx.globalAlpha = c.kind === "scrub" ? 0.5 : 1;
    ctx.lineWidth = c.kind === "scrub" ? 1 : 1.5;
    if (c.kind === "scrub") ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(c.a.x, c.a.y);
    ctx.lineTo(c.b.x, c.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
