/* Deck core — the store-free orchestrating composer.
 *
 * Builds the chrome-less HUD furniture (title bar, altimeter, center stage,
 * stats column, controls + transport), owns the one DeckController, mounts a
 * swappable center view into the stage, and forwards the active view's
 * tunables. It depends on its host only through injected `DeckHostHooks`
 * (play-state ownership + optional chrome-sync callbacks), so the same code
 * drives the full-app lens wrapper (hooks → Zustand store) and the
 * react-less embed host (hooks → its own rAF flag). No React, no store, no
 * external libraries.
 */

import type {
  CommitGlyph,
  LensTunable,
  OutcomeBanner,
  TunableValue,
} from "@/lenses/types";
import type { Params } from "@/lib/types";
import { renderToPre } from "@/lib/ascii";
import type {
  BlockoideConfig,
  BlockoideOutcome,
  SubstrateState,
} from "../engine";
import { hashState, pieceCells } from "../engine";
import { makeDeckController, type BlockoideHistory } from "./controller";
import { buildNextSurface, GLYPH_SETS } from "./render";
import {
  CENTER_VIEWS,
  centerViewById,
  type CenterView,
  type CenterViewId,
} from "./view";
// Title "EL BLOCKOIDE" as an inline SVG (one stroked path) — recolored to the
// accent in CSS. Inlined as markup so the embed needs no font + no asset
// request; gzips far smaller than a display font.
import logoSvg from "./assets/logo.svg?raw";

// The deck's dependency on whatever host mounts it. Play-state is the
// host's (the full-app rAF gates on the store; the embed gates on its own
// flag); the optional callbacks let a chrome sync its timeline.
export type DeckHostHooks = {
  isPlaying(): boolean;
  setPlaying(playing: boolean): void;
  onPlayhead?(tick: number): void;
  onHistoryChanged?(): void;
  // Whether the deck draws its own win/lose overlay. The embed host has no
  // chrome, so it owns it (default true); the full app defers to the
  // chrome's OutcomeDialog (set false) to avoid a double modal.
  ownsOutcomeOverlay?: boolean;
};

export type MountedDeck = {
  unmount(): void;
  renderFrom(state: SubstrateState): void;
  tick(): void;
  speedMult(): number;
  setSpeed(id: string): void;
  snapshot(): HTMLCanvasElement | null;
  getTunable(path: string[]): TunableValue | undefined;
  setTunable(path: string[], value: TunableValue): void;
  subscribeTunables(listener: () => void): () => void;
};

// The deck's own view-selector tunable, plus the deduped union of every
// view's tunables (forwarded to whichever view is active). Listed statically
// for the full-app inspector; the embed builds its own controls.
const CENTER_TUNABLE: LensTunable = {
  id: "center",
  group: "View",
  label: "View",
  type: "enum",
  options: CENTER_VIEWS.map((v) => v.id),
  target: "lens",
  path: ["center"],
};

function unionViewTunables(): LensTunable[] {
  const seen = new Set<string>();
  const out: LensTunable[] = [];
  for (const v of CENTER_VIEWS) {
    for (const t of v.tunables) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

// Deck composition — which HUD parts are shown. Each is a boolean tunable
// (default on) so a host can hide chrome it doesn't want: a feed-post embed
// might drop the key hints + transport for a clean autoplaying loop. The
// stage (the game itself) is never optional. Setupable via the export
// pipeline, e.g. `--set show_keyhints=false`.
type DeckPart = "titlebar" | "altimeter" | "stats" | "transport" | "keyhints";

const PART_TUNABLES: { tunable: LensTunable; part: DeckPart }[] = [
  { part: "titlebar",  tunable: partTunable("show_titlebar", "Title") },
  { part: "altimeter", tunable: partTunable("show_altimeter", "Altimeter") },
  { part: "stats",     tunable: partTunable("show_stats", "Stats panel") },
  { part: "transport", tunable: partTunable("show_transport", "Transport") },
  { part: "keyhints",  tunable: partTunable("show_keyhints", "Key hints") },
];

const PART_BY_ID: Record<string, DeckPart> = Object.fromEntries(
  PART_TUNABLES.map(({ tunable, part }) => [tunable.id, part]),
);

function partTunable(id: string, label: string): LensTunable {
  return { id, group: "Deck", label, type: "bool", target: "lens", path: [id] };
}

export const DECK_TUNABLES: LensTunable[] = [
  CENTER_TUNABLE,
  ...PART_TUNABLES.map((p) => p.tunable),
  ...unionViewTunables(),
];

const CONTROLS_TEXT =
  "← → ↑ ↓ move · Q E / A D / W S rotate · Shift soft · Enter hard drop";

// One "rewind" press steps the take-back back ~1 second (the base tick is
// 60 Hz, per the grid-mover sub-1-speed invariant).
const REWIND_TICKS = 60;

export function mountDeck(
  container: HTMLElement,
  history: BlockoideHistory,
  hooks: DeckHostHooks,
  opts: { autopilot?: boolean } = {},
): MountedDeck {
  const config = history.config;
  const { H } = config;

  // --- furniture skeleton ------------------------------------------------
  const root = document.createElement("div");
  root.className = "blk-deck";

  const titlebar = document.createElement("div");
  titlebar.className = "blk-deck-titlebar";
  titlebar.setAttribute("role", "img");
  titlebar.setAttribute("aria-label", "EL BLOCKOIDE");
  titlebar.innerHTML = logoSvg;

  const main = document.createElement("div");
  main.className = "blk-deck-main";

  // Region 1 — altimeter.
  const alti = buildAltimeter(H);
  // Center stage — the active view mounts here.
  const stage = document.createElement("div");
  stage.className = "blk-deck-stage";
  // Stats column.
  const stats = buildStats(config);

  main.append(alti.el, stage, stats.el);

  // Region 2 — controls + transport.
  const controls = document.createElement("div");
  controls.className = "blk-deck-controls";
  const transport = document.createElement("div");
  transport.className = "blk-deck-transport";
  const keyhints = document.createElement("div");
  keyhints.className = "blk-deck-keyhints";
  keyhints.textContent = CONTROLS_TEXT;
  controls.append(transport, keyhints);

  root.append(titlebar, main, controls);
  container.appendChild(root);

  // --- deck composition (which parts are shown) --------------------------
  // Inline `display` (not the `hidden` attr) so it beats the flex/grid
  // display rules in deck.css.
  const partEls: Record<DeckPart, HTMLElement> = {
    titlebar,
    altimeter: alti.el,
    stats: stats.el,
    transport,
    keyhints,
  };
  const partVisible: Record<DeckPart, boolean> = {
    titlebar: true, altimeter: true, stats: true, transport: true, keyhints: true,
  };
  function setPart(part: DeckPart, visible: boolean): void {
    partVisible[part] = visible;
    partEls[part].style.display = visible ? "" : "none";
  }

  // --- controller + active view ------------------------------------------
  const ctrl = makeDeckController(history, opts);

  let center_id: CenterViewId = "shaft";
  let view: CenterView = centerViewById(center_id).make(stage, config);
  const tunableListeners = new Set<() => void>();
  let viewUnsub = view.subscribeTunables(() => {
    for (const cb of tunableListeners) cb();
  });

  function swapCenter(id: string): void {
    const next = CENTER_VIEWS.find((v) => v.id === id);
    if (!next || next.id === center_id) return;
    viewUnsub();
    view.unmount();
    center_id = next.id;
    view = next.make(stage, config); // substrate/history untouched — view swap only
    viewUnsub = view.subscribeTunables(() => {
      for (const cb of tunableListeners) cb();
    });
    syncTransport();
    for (const cb of tunableListeners) cb();
  }

  // --- overlay (outcome + credits) ---------------------------------------
  const overlay = document.createElement("div");
  overlay.className = "blk-deck-overlay";
  overlay.hidden = true;
  root.appendChild(overlay);

  function hideOverlay(): void {
    overlay.hidden = true;
    overlay.replaceChildren();
  }
  function showCard(card: HTMLElement): void {
    card.className = "blk-deck-card";
    overlay.replaceChildren(card);
    overlay.hidden = false;
  }
  function showOutcome(s: SubstrateState): void {
    const banner = outcomeFor({ outcome: s.outcome, layers: s.layers });
    if (!banner) return;
    const card = document.createElement("div");
    const h = document.createElement("div");
    h.className = `blk-deck-card-title is-${banner.status}`;
    h.textContent = banner.title;
    card.appendChild(h);
    if (banner.body) {
      const b = document.createElement("div");
      b.className = "blk-deck-card-body";
      b.textContent = banner.body;
      card.appendChild(b);
    }
    const again = mkButton("↺ play again", () => {
      ctrl.restart();
      hooks.setPlaying(true);
    });
    card.appendChild(again);
    showCard(card);
  }

  // --- transport buttons (sibling control surface) -----------------------
  const btnPlay = mkButton("", () => hooks.setPlaying(!hooks.isPlaying()));
  const btnRewind = mkButton("⏪ rewind", () => {
    ctrl.rewindBy(REWIND_TICKS);
    hooks.setPlaying(true);
  });
  const btnRestart = mkButton("↺ restart", () => {
    ctrl.restart();
    hooks.setPlaying(true);
  });
  const btnAuto = mkButton("", () => {
    ctrl.setAutopilot(!ctrl.isAutopilot());
    if (ctrl.isAutopilot()) hooks.setPlaying(true);
    syncTransport();
  });
  const btnView = mkButton("", () => {
    const i = CENTER_VIEWS.findIndex((v) => v.id === center_id);
    swapCenter(CENTER_VIEWS[(i + 1) % CENTER_VIEWS.length]!.id);
  });
  const btnCredits = mkButton("credits", () =>
    showCard(buildCredits(hideOverlay)),
  );
  transport.append(btnPlay, btnAuto, btnRewind, btnRestart, btnView, btnCredits);
  function syncTransport(): void {
    btnPlay.textContent = hooks.isPlaying() ? "⏸ pause" : "▶ play";
    btnAuto.textContent = ctrl.isAutopilot() ? "🤖 auto on" : "🤖 auto";
    btnAuto.classList.toggle("is-on", ctrl.isAutopilot());
    btnView.textContent = `◳ ${centerViewById(center_id).label}`;
  }
  syncTransport();

  // --- controller change → furniture + host sync -------------------------
  const ctrlUnsub = ctrl.onChange((e) => {
    hooks.onPlayhead?.(e.tick);
    if (e.branched || e.reanchored) hooks.onHistoryChanged?.();
    if (e.outcome !== "in_progress") {
      hooks.setPlaying(false);
      if (hooks.ownsOutcomeOverlay !== false)
        showOutcome(history.substrate.read);
    } else if (e.reanchored) {
      // restart / rewind cleared a terminal state — drop any outcome card.
      hideOverlay();
    }
  });

  // --- per-frame render --------------------------------------------------
  let last_tick = -1;
  let last_next = -2;
  let last_outcome: BlockoideOutcome | "" = "";

  function renderFrom(state: SubstrateState): void {
    view.renderFrom(state);
    syncTransport(); // cheap; keeps the play button in sync with external toggles

    if (state.tick !== last_tick || state.outcome !== last_outcome) {
      last_tick = state.tick;
      last_outcome = state.outcome;
      stats.update(state);
      alti.update(state);
    }
    if (state.next_kind !== last_next) {
      last_next = state.next_kind;
      renderToPre(
        buildNextSurface(state.next_kind, GLYPH_SETS.blocks!),
        stats.next,
      );
    }
  }

  return {
    unmount() {
      ctrlUnsub();
      viewUnsub();
      view.unmount();
      ctrl.detach();
      if (root.parentNode === container) container.removeChild(root);
    },
    renderFrom,
    tick: ctrl.doOneTick,
    speedMult: ctrl.speedMult,
    setSpeed: ctrl.setSpeed,
    snapshot: () => view.snapshot?.() ?? null,
    getTunable(path) {
      if (path.length === 1 && path[0] === "center") return center_id;
      if (path.length === 1 && path[0] && path[0] in PART_BY_ID) {
        return partVisible[PART_BY_ID[path[0]]!];
      }
      return view.getTunable(path);
    },
    setTunable(path, value) {
      if (
        path.length === 1 &&
        path[0] === "center" &&
        typeof value === "string"
      ) {
        swapCenter(value);
        return;
      }
      if (path.length === 1 && path[0] && path[0] in PART_BY_ID) {
        setPart(PART_BY_ID[path[0]]!, value === true || value === "true");
        for (const cb of tunableListeners) cb();
        return;
      }
      view.setTunable(path, value);
    },
    subscribeTunables(listener) {
      tunableListeners.add(listener);
      return () => tunableListeners.delete(listener);
    },
  };
}

// --- furniture builders ----------------------------------------------------

function mkButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "blk-deck-btn";
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// Region 1 — a vertical gauge of the well: one segment per depth level
// (z=0 opening at top → z=H-1 floor at bottom). Each segment's fill shows
// how packed that layer is; the falling piece's z-span is marked bright.
function buildAltimeter(H: number): {
  el: HTMLElement;
  update(s: SubstrateState): void;
} {
  const el = document.createElement("div");
  el.className = "blk-deck-altimeter";
  const tube = document.createElement("div");
  tube.className = "blk-deck-alti-tube";
  const segs: HTMLDivElement[] = [];
  for (let z = 0; z < H; z++) {
    const seg = document.createElement("div");
    seg.className = "blk-deck-alti-seg";
    tube.appendChild(seg);
    segs.push(seg);
  }
  const label = document.createElement("div");
  label.className = "blk-deck-alti-label";
  el.append(tube, label);

  function update(s: SubstrateState): void {
    const area = s.W * s.D;
    const pieceZ = new Set<number>();
    if (s.piece_kind >= 0 && s.outcome === "in_progress") {
      for (const c of pieceCells(s.piece_kind, s.orient))
        pieceZ.add(s.piece_z + c.z);
    }
    let minPieceZ = Infinity;
    for (let z = 0; z < s.H; z++) {
      let filled = 0;
      for (let i = z * area; i < (z + 1) * area; i++)
        if ((s.cells[i] ?? 0) !== 0) filled++;
      const frac = area > 0 ? filled / area : 0;
      const seg = segs[z]!;
      seg.style.setProperty("--fill", frac.toFixed(3));
      seg.classList.toggle("is-piece", pieceZ.has(z));
      if (pieceZ.has(z)) minPieceZ = Math.min(minPieceZ, z);
    }
    label.textContent = minPieceZ === Infinity ? "—" : `z ${minPieceZ}`;
  }

  return { el, update };
}

// Stats column — the small monospace readouts + NEXT preview.
function buildStats(config: BlockoideConfig): {
  el: HTMLElement;
  next: HTMLPreElement;
  update(s: SubstrateState): void;
} {
  const el = document.createElement("div");
  el.className = "blk-deck-stats";

  const layers = document.createElement("div");
  const pieces = document.createElement("div");
  const size = document.createElement("div");
  size.className = "blk-deck-dim";
  size.textContent = `WELL ${config.W}×${config.D}×${config.H}`;
  const hash = document.createElement("div");
  hash.className = "blk-deck-hash";
  const nextLabel = document.createElement("div");
  nextLabel.className = "blk-deck-dim";
  nextLabel.textContent = "NEXT";
  const next = document.createElement("pre");
  next.className = "blk-deck-next";
  el.append(layers, pieces, size, hash, nextLabel, next);

  function update(s: SubstrateState): void {
    const target = config.win_layers > 0 ? `/${config.win_layers}` : "";
    layers.textContent = `layers ${s.layers}${target}`;
    pieces.textContent = `pieces ${s.spawn_count}`;
    hash.textContent = hashState(s);
  }

  return { el, next, update };
}

// Credits card content — the Blockout lineage, the font, the engine.
function buildCredits(onClose: () => void): HTMLElement {
  const card = document.createElement("div");
  const title = document.createElement("div");
  title.className = "blk-deck-card-title";
  title.textContent = "EL BLOCKOIDE";
  const body = document.createElement("div");
  body.className = "blk-deck-credits";

  const link = (label: string, href: string): HTMLAnchorElement => {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    return a;
  };
  const row = (lead: string, a: HTMLAnchorElement): HTMLElement => {
    const r = document.createElement("div");
    r.append(document.createTextNode(`${lead} `), a);
    return r;
  };

  const engineRow = document.createElement("div");
  engineRow.textContent = "Built on the El Coso engine.";
  body.append(
    row(
      "After",
      link(
        "Blockout (1989) — 3D Tetris",
        "https://en.wikipedia.org/wiki/Blockout",
      ),
    ),
    row(
      "Title font",
      link(
        "Rubik Doodle Shadow",
        "https://fonts.google.com/specimen/Rubik+Doodle+Shadow",
      ),
    ),
    engineRow,
  );

  const close = mkButton("close", onClose);
  card.append(title, body, close);
  return card;
}

// --- chrome-vocabulary helpers (store-free; shared by the lens wrapper and
//     the embed overlay) -------------------------------------------------

export function commitGlyph(payload: Params): CommitGlyph {
  const outcome = payload["outcome"];
  if (outcome === "won") return { kind: "char", char: "🏁" };
  if (outcome === "lost") return { kind: "char", char: "✕" };
  const piece = payload["piece"];
  return { kind: "char", char: typeof piece === "string" ? piece : "·" };
}

export function outcomeFor(payload: Params): OutcomeBanner | null {
  const outcome = payload["outcome"];
  const layers = typeof payload["layers"] === "number" ? payload["layers"] : 0;
  if (outcome === "won") {
    return {
      status: "won",
      title: "Well cleared",
      body: `${layers} layers — the well audits a clean pack.`,
    };
  }
  if (outcome === "lost") {
    return {
      status: "lost",
      title: "Topped out",
      body: `The stack reached the opening after ${layers} cleared layers.`,
    };
  }
  return null;
}

export function hudMetricsFor(history: BlockoideHistory) {
  return () => {
    const s = history.substrate.read;
    return [
      { id: "layers", label: "layers", value: String(s.layers) },
      { id: "pieces", label: "pieces", value: String(s.spawn_count) },
      { id: "hash", label: "hash", value: hashState(s).slice(0, 4) },
    ];
  };
}
