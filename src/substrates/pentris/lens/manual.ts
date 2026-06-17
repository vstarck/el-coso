/* Pentris Manual lens — a static, paged, in-canvas manual.
 *
 * The Manual-lens pattern (an in-canvas, paged manual): a sibling lens
 * that never advances the substrate (no `tick`, no `AUTOPLAY` → the chrome
 * hides the transport), pages selected by one enum tunable, and every
 * illustration drawn with the substrate's *own* engine code — the pieces
 * below come from `pieceCells`, the colors from the live palettes — so the
 * documentation cannot drift from the thing it documents. `snapshot()`
 * makes any page a shareable picture.
 *
 * Mechanics only, never strategy — an out-of-band manual, not an in-world
 * hint, so "the universe doesn't help" stays intact.
 */

import { attachCanvasSizing } from "@/lib/canvas/sizing";
import { wrapText } from "@/lib/canvas/text";
import type { SpeedOption } from "@/lib/types";
import type { Params } from "@/lib/types";
import type {
  Cadence,
  CommitGlyph,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  TunableValue,
  ViewportInset,
} from "@/lenses/types";
import type {
  PentrisCommitPayload,
  PentrisConfig,
  PentrisInputs,
  SubstrateState,
} from "../engine";
import { PIECE_NAMES, pieceCells } from "../engine";
import { pieceColor, type PaletteId } from "./render";

const BG = "#0b0d12";
const TEXT = "#cbd5e1";
const DIM = "#64748b";
const SEP = "rgba(148,163,184,0.30)";
const ACCENT = "#7dd3fc";

type Rect = { x: number; y: number; w: number; h: number };

type ManualPage = "intro" | "pieces" | "time";
const PAGES: ManualPage[] = ["intro", "pieces", "time"];
const PAGE_LABEL: Record<ManualPage, string> = {
  intro: "Introduction",
  pieces: "The twelve pieces",
  time: "Time travel & forking",
};

const SPEEDS: SpeedOption[] = [{ id: "1x", label: "1x", mult: 1, isDefault: true }];
const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  {
    id: "page",
    group: "Manual",
    label: "Page",
    type: "enum",
    options: PAGES.map((p) => PAGE_LABEL[p]),
    display: "list",
    target: "lens",
    path: ["page"],
  },
];

// --- helpers ---------------------------------------------------------------

function paragraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  color = TEXT,
): number {
  const lh = 22;
  ctx.font = "14px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (const line of wrapText(ctx, text, w)) {
    ctx.fillText(line, x, y);
    y += lh;
  }
  return y + lh * 0.5;
}

// A piece at spawn orientation, drawn by the live `pieceCells` — the same
// cells the tick collides.
function drawPiece(
  ctx: CanvasRenderingContext2D,
  kind: number,
  x: number,
  y: number,
  cp: number,
  palette: PaletteId,
): void {
  ctx.fillStyle = pieceColor(kind, palette);
  for (const c of pieceCells(kind, 0)) {
    ctx.fillRect(x + c.x * cp + 1, y + c.y * cp + 1, cp - 2, cp - 2);
  }
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  page: ManualPage,
  x: number,
  y: number,
): number {
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.fillStyle = TEXT;
  ctx.fillText("Pentris · Manual", x, y);
  ctx.font = "15px ui-monospace, monospace";
  ctx.fillStyle = ACCENT;
  ctx.fillText(PAGE_LABEL[page], x, y + 30);
  return y + 58;
}

// --- pages -------------------------------------------------------------------

function drawIntro(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const x = rect.x;
  const w = Math.min(rect.w, 760);
  let y = rect.y;

  y = paragraph(
    ctx,
    "Pentris is a falling-block stacker built on the twelve free pentominoes — five-cell pieces, each named after the letter it resembles. Pieces enter at the top of the well and fall under gravity; you steer, rotate and drop them; a full row resolves and everything above shifts down. Reach the puzzle's line target to win; let the stack reach the spawn row and you top out.",
    x,
    y,
    w,
  );
  y = paragraph(
    ctx,
    "The Workbench is three views of one state. Column A is the substrate state, literally — a read-only JSON digest, the board as letter-rows. Column B is the well. Column C is the recent history: one node per placement, drawn by the same layout engine as the chrome timeline below.",
    x,
    y,
    w,
  );

  ctx.font = "14px ui-monospace, monospace";
  ctx.fillStyle = DIM;
  ctx.fillText("Controls", x, y);
  y += 26;
  const rows: Array<[string, string]> = [
    ["◀ ▶ / A D", "move (held — auto-repeats)"],
    ["▲ / X", "rotate clockwise"],
    ["Z", "rotate counter-clockwise"],
    ["▼ / S", "soft drop (held)"],
    ["⏎ Enter", "hard drop — to the floor, locks at once"],
    ["Space", "chrome play/pause — not a game key"],
  ];
  for (const [keys, what] of rows) {
    ctx.fillStyle = ACCENT;
    ctx.fillText(keys.padEnd(11), x, y);
    ctx.fillStyle = TEXT;
    ctx.fillText(what, x + 120, y);
    y += 22;
  }
  y += 12;

  // A small cast sample, drawn by the real renderer.
  const sample = [4, 5, 8]; // P, T, W
  let px = x;
  for (const kind of sample) {
    drawPiece(ctx, kind, px, y, 14, "vivid");
    px += 5 * 14 + 18;
  }
}

function drawPieces(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const x = rect.x;
  let y = rect.y;
  y = paragraph(
    ctx,
    "All twelve, at spawn orientation, drawn by the live piece tables. Rotations are computed — a quarter-turn is a coordinate map — and reflections are not available: the mirrored forms of F, L, N, Y and Z are shapes you never get.",
    x,
    y,
    Math.min(rect.w, 760),
  );

  const cols = 4;
  const cell_w = Math.floor(rect.w / cols);
  const cell_h = Math.max(96, Math.floor((rect.y + rect.h - y - 60) / 3));
  const cp = Math.max(10, Math.min(18, Math.floor((cell_w - 70) / 5)));

  for (let k = 0; k < 12; k++) {
    const cx = x + (k % cols) * cell_w;
    const cy = y + Math.floor(k / cols) * cell_h;
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillStyle = TEXT;
    ctx.textBaseline = "top";
    ctx.fillText(PIECE_NAMES[k] ?? "?", cx, cy + 2);
    // geometry-palette chip beside the letter
    ctx.fillStyle = pieceColor(k, "geometry");
    ctx.fillRect(cx + 22, cy + 6, 12, 12);
    ctx.strokeStyle = SEP;
    ctx.strokeRect(cx + 22.5, cy + 6.5, 12, 12);
    drawPiece(ctx, k, cx + 48, cy, cp, "vivid");
  }
  y += 3 * cell_h + 8;

  paragraph(
    ctx,
    "Pieces draw in the vivid palette (hand-picked). The chip beside each letter is the geometry palette — computed from the piece's own cell configuration: hue from the principal-axis angle, saturation from elongation, lightness inverse to it. A hypothetical 13th piece would arrive pre-colored. Switch palettes in the Lens panel.",
    x,
    Math.min(y, rect.y + rect.h - 96),
    Math.min(rect.w, 760),
    DIM,
  );
}

function drawTime(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const x = rect.x;
  const w = Math.min(rect.w, 760);
  let y = rect.y;

  y = paragraph(
    ctx,
    "A commit is a placement: it lands on the tick a piece locks and its rows resolve. Mid-fall moves and rotations are recorded in the input log — replay is bit-exact — but they mint no commits, so the timeline reads as the sequence of decisions. Each commit's glyph is the letter of the piece that was placed.",
    x,
    y,
    w,
  );
  y = paragraph(
    ctx,
    "Click a commit — in column C or the chrome timeline — to go there. Nothing forks: if the run is playing, the recorded inputs replay forward, and watching never branches. The fork happens on the first tick you touch the piece while behind a head. \"Go back and drop it elsewhere\" is the entire branching gesture.",
    x,
    y,
    w,
  );
  y = paragraph(
    ctx,
    "Every commit also carries a content hash of its configuration (stack, piece, preview, score — the clock excluded). The hash is the commit's address: branches that reconverge on the same configuration carry the same hash.",
    x,
    y,
    w,
  );

  // Fork-and-pinch diagram: two placement orders, one configuration.
  const r = 11;
  const step = 64;
  const y_mid = y + 56;
  const y_top = y_mid - 26;
  const y_bot = y_mid + 26;

  function node(cx: number, cy: number, letter: string): void {
    ctx.strokeStyle = SEP;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillStyle = TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, cx, cy + 0.5);
  }
  function edge(x1: number, y1: number, x2: number, y2: number): void {
    ctx.strokeStyle = SEP;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  const x0 = x + r + 2;
  edge(x0 + r, y_mid, x0 + step - r, y_mid);
  node(x0, y_mid, "T");
  node(x0 + step, y_mid, "L");
  // fork
  edge(x0 + step + r, y_mid - 4, x0 + 2 * step - r, y_top);
  edge(x0 + step + r, y_mid + 4, x0 + 2 * step - r, y_bot);
  node(x0 + 2 * step, y_top, "W");
  node(x0 + 2 * step, y_bot, "X");
  edge(x0 + 2 * step + r, y_top, x0 + 3 * step - r, y_top);
  edge(x0 + 2 * step + r, y_bot, x0 + 3 * step - r, y_bot);
  node(x0 + 3 * step, y_top, "X");
  node(x0 + 3 * step, y_bot, "W");

  // both arms land on the same address
  const chip_x = x0 + 4 * step;
  ctx.font = "12px ui-monospace, monospace";
  const chip_w = ctx.measureText("a1b2c3d4").width + 16;
  edge(x0 + 3 * step + r, y_top, chip_x, y_mid - 8);
  edge(x0 + 3 * step + r, y_bot, chip_x, y_mid + 8);
  ctx.strokeStyle = ACCENT;
  ctx.strokeRect(chip_x + 0.5, y_mid - 10.5, chip_w, 21);
  ctx.fillStyle = ACCENT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("a1b2c3d4", chip_x + 8, y_mid + 0.5);

  ctx.textBaseline = "top";
  paragraph(
    ctx,
    "W then X, or X then W — different orders, same resulting configuration: the two branches' commits carry one address. Equal hashes are a claim worth checking, not a proof (a short digest can collide); the full state is the arbiter.",
    x,
    y_bot + 34,
    w,
    DIM,
  );
}

// --- mount -------------------------------------------------------------------

function mountManual(
  args: LensMountArgs<SubstrateState, PentrisConfig, PentrisInputs, PentrisCommitPayload>,
): MountedLens<SubstrateState> {
  const { container } = args;

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.setAttribute("aria-label", "pentris manual");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on pentris manual canvas");
  const sizing = attachCanvasSizing(canvas);

  let viewport_inset: ViewportInset = { top: 16, right: 16, bottom: 16, left: 16 };
  const lens_state = { page: PAGE_LABEL.intro };
  const tunableListeners = new Set<() => void>();

  function pageId(): ManualPage {
    return PAGES.find((p) => PAGE_LABEL[p] === lens_state.page || p === lens_state.page) ?? "intro";
  }

  function safeRect(): Rect {
    const PAD = 24;
    return {
      x: viewport_inset.left + PAD,
      y: viewport_inset.top + PAD,
      w: Math.max(1, canvas.width - viewport_inset.left - viewport_inset.right - PAD * 2),
      h: Math.max(1, canvas.height - viewport_inset.top - viewport_inset.bottom - PAD * 2),
    };
  }

  function renderPage(): void {
    const c = ctx as CanvasRenderingContext2D;
    c.fillStyle = BG;
    c.fillRect(0, 0, canvas.width, canvas.height);
    const rect = safeRect();
    const page = pageId();
    const top = drawHeader(c, page, rect.x, rect.y);
    const body: Rect = { x: rect.x, y: top, w: rect.w, h: Math.max(1, rect.y + rect.h - top) };
    if (page === "intro") drawIntro(c, body);
    else if (page === "pieces") drawPieces(c, body);
    else drawTime(c, body);
  }

  const unsubscribeViewport = args.subscribeViewport((inset) => {
    viewport_inset = inset;
    renderPage();
  });

  function commitGlyph(payload: Params): CommitGlyph {
    const outcome = payload["outcome"];
    if (outcome === "won") return { kind: "char", char: "🏁" };
    if (outcome === "lost") return { kind: "char", char: "✕" };
    const piece = payload["piece"];
    return { kind: "char", char: typeof piece === "string" ? piece : "·" };
  }

  return {
    unmount: () => {
      unsubscribeViewport();
      sizing.detach();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
    renderFrom: () => renderPage(), // static — ignores substrate state
    snapshot: () => canvas,
    commitGlyph,
    pause: () => {},
    resume: () => {},
    step: () => {},
    setSpeed: () => {},
    getTunable: (path: string[]): TunableValue | undefined =>
      path.length === 1 && path[0] === "page" ? lens_state.page : undefined,
    setTunable: (path: string[], value: TunableValue): void => {
      if (path.length === 1 && path[0] === "page" && typeof value === "string") {
        lens_state.page = value;
        renderPage();
        for (const cb of tunableListeners) cb();
      }
    },
    subscribeTunables: (listener: () => void): (() => void) => {
      tunableListeners.add(listener);
      return () => {
        tunableListeners.delete(listener);
      };
    },
  };
}

export const pentrisManualLens: Lens<
  SubstrateState,
  PentrisConfig,
  PentrisInputs,
  PentrisCommitPayload
> = {
  id: "pentris-manual",
  name: "Manual",
  tunables: TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "canvas2d",
  // No AUTOPLAY → static: the chrome hides the transport and never ticks.
  // SAFE_AREA keeps content inside the un-occluded rect.
  features: ["FLAT", "SAFE_AREA"],
  theme: { accent: ACCENT },
  mount: mountManual,
};
