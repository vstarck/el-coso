/* Pentris lens — "Workbench": three columns and two HUD strips.
 *
 *   [HUD]    lines · pieces · state-hash · NEXT preview
 *   [A|B|C]  A: dev-tool JSON of the substrate state (DOM, read-only)
 *            B: the well — classic stacker render (canvas2d)
 *            C: compact top-down history tree (canvas), windowed to the
 *               recent commits. Click a commit to *go there* — no fork.
 *               The fork materializes lazily, on the first divergent
 *               input while behind a head: watching the replay never
 *               branches; touching the piece does. "Go back and drop it
 *               elsewhere" IS the branch gesture.
 *   [HUD]    key legend
 *
 * Gameplay keys are owned via a capture-phase listener + preventDefault,
 * so the chrome's global bindings (useKeyboard) yield them; Space stays
 * the chrome's play/pause everywhere, hard drop is Enter.
 *
 *   Q1 — render target?    dom (the composite root is a <div>; B and C are
 *                            canvases the lens creates inside it).
 *   Q2 — viewport relation? BOUNDED — the lens sizes its own host.
 *   Q3 — storage?          one doubled Uint8Array channel + piece scalars.
 *   Q4 — agency?           held move/soft + tap-buffered rotate/hard drop,
 *                            drained at most one tap per tick.
 *   Q5 — pace?             autonomous (tick + speedMult; host owns rAF).
 *   Q6 — commit shape?     per-event — a commit per piece spawn; the glyph
 *                            is the pentomino's letter-name (the letter IS
 *                            the shape), payload carries the state-hash.
 */

import { useStore } from "@/app/store";
import {
  historyAdvance,
  historyBranchFrom,
  historySetActiveBranch,
  historyStateAt,
  historyTick,
} from "@/history";
// Session-free builder (see buildHistoryView.ts header). A lens must NOT
// import from `historyView.ts` — that module reaches `session`, which
// reaches the substrate registry, which reaches this package: an import
// cycle that crashes on any standalone import (tests, headless, bare host).
import { buildView, type HistoryView } from "@/lib/buildHistoryView";
import { layoutHistory, type HistoryViewState } from "@/lib/historyLayout";
import { paintHistory } from "@/lib/historyCanvas";
import type { Params, SpeedOption } from "@/lib/types";
import type {
  Cadence,
  CommitGlyph,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  OutcomeBanner,
  TunableValue,
} from "@/lenses/types";
import type {
  PentrisCommitPayload,
  PentrisConfig,
  PentrisInputs,
  SubstrateState,
} from "../engine";
import { hashState } from "../engine";
import { boardDigest, drawBoard, drawMiniPiece, type PaletteId } from "./render";

const ACCENT = "#7dd3fc";
const CELL_PX = 28;
const TREE_W = 260;
const COL_A_W = 300;
const NEXT_PX = 56;
const RECENT_COLUMNS = 16; // column-C window: the last N commit columns
const RECENT_LANES = 8; // column-C window: branches kept (active + newest)

const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1, isDefault: true },
  { id: "2x", label: "2x", mult: 2 },
  { id: "4x", label: "4x", mult: 4 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  {
    id: "show_ghost",
    group: "Lens",
    label: "Landing ghost",
    type: "enum",
    options: ["true", "false"],
    target: "lens",
    path: ["show_ghost"],
  },
  {
    id: "palette",
    group: "Lens",
    label: "Piece palette",
    type: "enum",
    options: ["vivid", "geometry"],
    target: "lens",
    path: ["palette"],
  },
];

const NEUTRAL: PentrisInputs = { move: 0, rotate: 0, soft: false, hard: false };

const PANEL_BG = "rgba(15,17,21,0.85)";
const PANEL_BORDER = "1px solid #1f2430";

function setupCanvas(css_w: number, css_h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(css_w * dpr);
  canvas.height = Math.round(css_h * dpr);
  canvas.style.width = `${css_w}px`;
  canvas.style.height = `${css_h}px`;
  canvas.style.display = "block";
  canvas.style.borderRadius = "6px";
  canvas.style.border = PANEL_BORDER;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on pentris canvas");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx };
}

function mountPentris(
  args: LensMountArgs<SubstrateState, PentrisConfig, PentrisInputs, PentrisCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history } = args;
  const config = history.config;
  const board_w = config.W * CELL_PX;
  const board_h = config.H * CELL_PX;

  // --- DOM skeleton (Q1: dom) ------------------------------------------
  const root = document.createElement("div");
  root.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "padding:12px",
    "width:fit-content",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#cbd5e1",
    "font-size:13px",
    "user-select:none",
  ].join(";");
  container.appendChild(root);

  const hud_top = document.createElement("div");
  hud_top.style.cssText =
    "display:flex;align-items:center;gap:14px;justify-content:space-between";
  const hud_stats = document.createElement("div");
  hud_stats.style.cssText = "display:flex;gap:14px;align-items:baseline";
  const stat_lines = document.createElement("span");
  const stat_pieces = document.createElement("span");
  const stat_hash = document.createElement("span");
  stat_hash.style.cssText = `color:${ACCENT}`;
  stat_hash.title =
    "content hash of the current configuration — the commit address";
  hud_stats.append(stat_lines, stat_pieces, stat_hash);
  const hud_next = document.createElement("div");
  hud_next.style.cssText = "display:flex;align-items:center;gap:6px";
  const next_label = document.createElement("span");
  next_label.textContent = "NEXT";
  next_label.style.color = "#64748b";
  const { canvas: next_canvas, ctx: next_ctx } = setupCanvas(NEXT_PX, NEXT_PX);
  hud_next.append(next_label, next_canvas);
  hud_top.append(hud_stats, hud_next);

  const cols = document.createElement("div");
  cols.style.cssText = "display:flex;gap:8px;align-items:stretch";

  // Column A — the substrate state, literally (read-only JSON).
  const col_a = document.createElement("pre");
  col_a.style.cssText = [
    `width:${COL_A_W}px`,
    `height:${board_h}px`,
    "margin:0",
    "padding:8px",
    "overflow:auto",
    // Sized so the whole digest (scalars + the 22 board rows) fits the
    // board-height panel without scrolling — the dev view stays fully
    // visible whenever the viewport allows the lens at natural size.
    "font-size:11px",
    "line-height:1.32",
    "color:#94a3b8",
    `background:${PANEL_BG}`,
    `border:${PANEL_BORDER}`,
    "border-radius:6px",
    "user-select:text",
  ].join(";");
  col_a.setAttribute("aria-label", "pentris state inspector");

  // Column B — the well.
  const { canvas: board_canvas, ctx: board_ctx } = setupCanvas(board_w, board_h);
  board_canvas.setAttribute("aria-label", "pentris well");

  // Column C — the recent history tree, top-down.
  const { canvas: tree_canvas, ctx: tree_ctx } = setupCanvas(TREE_W, board_h);
  tree_canvas.setAttribute("aria-label", "pentris history tree");
  tree_canvas.style.cursor = "pointer";
  tree_canvas.title = "click a commit to jump — behind a head, the jump forks";

  cols.append(col_a, board_canvas, tree_canvas);

  const hud_bottom = document.createElement("div");
  hud_bottom.style.cssText = "color:#64748b;font-size:12px";
  hud_bottom.textContent =
    "◀ ▶ move · ▲/X rotate · Z counter-rotate · ▼ soft drop · ⏎ hard drop · click tree → go there · any input behind head forks";

  root.append(hud_top, cols, hud_bottom);

  // --- Input (Q4): held flags + tap queues ------------------------------
  // One keymap table, action → keys, so a rebind is a data edit. Space is
  // deliberately absent: it is the chrome's play/pause everywhere
  // (useKeyboard), including the bare host. Handlers attach in the
  // CAPTURE phase and preventDefault — the chrome's bubble-phase handler
  // checks defaultPrevented and yields, so these keys are exclusively
  // the game's while the lens is mounted.
  const KEYS: Record<"left" | "right" | "soft" | "rotate_cw" | "rotate_ccw" | "hard", string[]> = {
    left: ["ArrowLeft", "a", "A"],
    right: ["ArrowRight", "d", "D"],
    soft: ["ArrowDown", "s", "S"],
    rotate_cw: ["ArrowUp", "x", "X"],
    rotate_ccw: ["z", "Z"],
    hard: ["Enter"],
  };
  const held = { left: false, right: false, down: false };
  const tap_rotate: number[] = [];
  let tap_hard = 0;

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return; // chords belong to the chrome
    const k = e.key;
    if (KEYS.left.includes(k)) held.left = true;
    else if (KEYS.right.includes(k)) held.right = true;
    else if (KEYS.soft.includes(k)) held.down = true;
    else if (KEYS.rotate_cw.includes(k) && !e.repeat) {
      if (tap_rotate.length < 2) tap_rotate.push(1);
    } else if (KEYS.rotate_ccw.includes(k) && !e.repeat) {
      if (tap_rotate.length < 2) tap_rotate.push(-1);
    } else if (KEYS.hard.includes(k) && !e.repeat) {
      if (tap_hard < 2) tap_hard += 1;
    } else return;
    e.preventDefault();
  }
  function onKeyUp(e: KeyboardEvent): void {
    const k = e.key;
    if (KEYS.left.includes(k)) held.left = false;
    else if (KEYS.right.includes(k)) held.right = false;
    else if (KEYS.soft.includes(k)) held.down = false;
  }
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  function drainInputs(): PentrisInputs {
    const rotate = tap_rotate.shift() ?? 0;
    const hard = tap_hard > 0;
    if (tap_hard > 0) tap_hard -= 1;
    return {
      move: (held.right ? 1 : 0) - (held.left ? 1 : 0),
      rotate,
      soft: held.down,
      hard,
    };
  }

  // --- Tunables ----------------------------------------------------------
  const lens_state: Record<string, string> = { show_ghost: "true", palette: "vivid" };
  const tunableListeners = new Set<() => void>();
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    return lens_state[path[0] ?? ""];
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if ((key === "show_ghost" || key === "palette") && typeof value === "string") {
      lens_state[key] = value;
      last_next_kind = -2; // repaint the preview in the new palette
      for (const cb of tunableListeners) cb();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  // --- Tick loop (Q5: autonomous; replay-aware) --------------------------
  let speed_mult = 1;

  function liveTick(input: PentrisInputs): void {
    const before_spawn = history.substrate.read.spawn_count;
    historyTick(history, input);
    const st = history.substrate.read;
    useStore.getState().setPlayheadTick(st.tick);
    // Per-event commits: the tree changes exactly when a piece locks or
    // the run ends.
    if (st.spawn_count !== before_spawn || st.outcome !== "in_progress") {
      useStore.getState().bumpHistoryVersion();
    }
  }

  function doOneTick(): void {
    const active = history.branches[history.active]!;
    const cur = history.substrate.read.tick;

    // Behind the head: replay. Watching never forks — the recorded input
    // re-applies bit-exact. The fork materializes lazily, on the first
    // tick the player actually touches the piece: any non-neutral input
    // changes the deterministic future, so that tick is where the
    // timelines part.
    if (cur < active.head_tick) {
      const live = drainInputs();
      const diverging =
        live.move !== 0 || live.rotate !== 0 || live.soft || live.hard;
      if (!diverging) {
        const entry = active.inputs.find((e) => e.tick === cur + 1);
        historyAdvance(history, entry ? entry.input : NEUTRAL);
        useStore.getState().setPlayheadTick(history.substrate.read.tick);
        return;
      }
      let n = 1;
      while (history.branches[`wb-${n}`]) n++;
      const fork_id = `wb-${n}`;
      historyBranchFrom(history, history.active, cur, fork_id);
      historySetActiveBranch(history, fork_id);
      useStore.getState().bumpHistoryVersion();
      cached_view = null;
      liveTick(live);
      return;
    }

    // Live head. Terminal ⇒ halt autoplay; the head rests on the outcome
    // commit.
    if (history.substrate.read.outcome !== "in_progress") {
      useStore.getState().setPlaying(false);
      return;
    }

    liveTick(drainInputs());
  }

  // --- Glyph: the pentomino letter IS the shape icon ---------------------
  function commitGlyph(payload: Params): CommitGlyph {
    const outcome = payload["outcome"];
    if (outcome === "won") return { kind: "char", char: "🏁" };
    if (outcome === "lost") return { kind: "char", char: "✕" };
    const piece = payload["piece"];
    return { kind: "char", char: typeof piece === "string" ? piece : "·" };
  }

  function clumpKey(params: Params): string {
    const g = commitGlyph(params);
    return g.kind === "char" ? `char:${g.char}` : g.kind;
  }

  // --- Column C: windowed tree + click-to-jump ---------------------------
  let cached_view: HistoryView | null = null;
  let cached_version = -1;
  let last_vs: HistoryViewState | null = null;

  // Window the view to the last N branches BEFORE layout — filter the
  // lanes, not the pixels. Lanes past the canvas edge already clipped, but
  // their fork curves *into* visible lanes still painted as stray arcs;
  // dropping the branches up front removes node, baseline, and curve
  // together. The active branch is always kept; the rest are the newest.
  function windowLanes(view: HistoryView, max: number): HistoryView {
    if (view.branches.length <= max) return view;
    const keep = new Set<string>([view.activeBranchId]);
    for (let i = view.branches.length - 1; i >= 0 && keep.size < max; i--) {
      keep.add(view.branches[i]!.id);
    }
    const branches = view.branches
      .filter((b) => keep.has(b.id))
      .map((b, lane) => ({ ...b, lane }));
    const commits = view.commits.filter((c) => keep.has(c.branchId));
    const branchById: HistoryView["branchById"] = {};
    for (const b of branches) branchById[b.id] = b;
    const commitById: HistoryView["commitById"] = {};
    for (const c of commits) commitById[c.id] = c;
    const ticks = new Set<number>();
    for (const c of commits) ticks.add(c.tick);
    return {
      ...view,
      branches,
      commits,
      branchById,
      commitById,
      columnTicks: [...ticks].sort((a, b) => a - b),
      lanesCount: Math.max(1, branches.length),
      maxHeadTick: branches.reduce((m, b) => Math.max(m, b.headTick), 0),
    };
  }

  function drawTree(state: SubstrateState): void {
    const version = useStore.getState().historyVersion;
    if (!cached_view || version !== cached_version) {
      cached_view = windowLanes(buildView(history), RECENT_LANES);
      cached_version = version;
    }
    const view = cached_view;
    tree_ctx.fillStyle = "#0b0d12";
    tree_ctx.fillRect(0, 0, TREE_W, board_h);
    if (view.commits.length === 0) return;
    const c1 = Math.max(0, view.columnTicks.length - 1);
    const c0 = Math.max(0, c1 - RECENT_COLUMNS);
    const vs = layoutHistory(view, {
      width: TREE_W,
      columnRange: [c0, c1],
      orientation: "top-down",
      strategy: "recent",
      // The lane window (windowLanes, above) plus the column window is the
      // "last N branches / last N commits" porthole.
      box: { mainStart: 16, mainLen: board_h - 32, crossStart: 12 },
      laneColor: () => "rgba(148,163,184,0.5)",
      clumpKey,
      cursors: {
        playheadTick: state.tick,
        scrubTick: null,
        headCommitId: view.headCommitId,
      },
    });
    last_vs = vs;
    paintHistory(tree_ctx, vs, { glyphOf: commitGlyph, accent: ACCENT });
  }

  function onTreeClick(e: MouseEvent): void {
    if (!last_vs) return;
    const x = e.offsetX;
    const y = e.offsetY;
    let best: { branchId: string; tick: number } | null = null;
    let best_d = 12 * 12;
    for (const n of last_vs.nodes) {
      if (n.kind !== "commit" || n.tick === undefined) continue;
      const dx = n.at.x - x;
      const dy = n.at.y - y;
      const d = dx * dx + dy * dy;
      if (d < best_d) {
        best = { branchId: n.branchId, tick: n.tick };
        best_d = d;
      }
    }
    if (!best) return;
    // Clicking is navigation, not branching (goBackToCommit semantics —
    // hand-rolled here because the lens can't import src/app/lib/bttf.ts
    // without an app-tier cycle through session → substrates). The
    // substrate re-anchors at the commit and, if playing, replays the
    // record forward; the fork only happens later, in doOneTick, the
    // moment the player diverges from the recording.
    if (best.branchId !== history.active) {
      historySetActiveBranch(history, best.branchId);
    }
    historyStateAt(history, best.branchId, best.tick);
    useStore.getState().setPlayheadTick(best.tick);
    useStore.getState().bumpHistoryVersion();
    cached_view = null; // active branch may have changed; rebuild
  }
  tree_canvas.addEventListener("click", onTreeClick);

  // --- Render -------------------------------------------------------------
  let last_digest_tick = -1;
  let last_next_kind = -2;

  function palette(): PaletteId {
    return lens_state.palette === "geometry" ? "geometry" : "vivid";
  }

  function renderFrom(state: SubstrateState): void {
    drawBoard(board_ctx, state, {
      cell_px: CELL_PX,
      show_ghost: lens_state.show_ghost === "true",
      palette: palette(),
    });
    drawTree(state);

    if (state.tick !== last_digest_tick) {
      last_digest_tick = state.tick;
      col_a.textContent = boardDigest(state, config);
      const target = config.win_lines > 0 ? `/${config.win_lines}` : "";
      stat_lines.textContent = `lines ${state.lines}${target}`;
      stat_pieces.textContent = `pieces ${state.spawn_count}`;
      stat_hash.textContent = hashState(state);
    }
    if (state.next_kind !== last_next_kind) {
      last_next_kind = state.next_kind;
      drawMiniPiece(next_ctx, state.next_kind, NEXT_PX, palette());
    }
  }

  function renderThumbnail(state: SubstrateState, target: HTMLCanvasElement): void {
    const tctx = target.getContext("2d");
    if (!tctx) return;
    const cell_px = Math.max(
      1,
      Math.floor(Math.min(target.width / config.W, target.height / config.H)),
    );
    tctx.save();
    tctx.translate(
      Math.floor((target.width - config.W * cell_px) / 2),
      Math.floor((target.height - config.H * cell_px) / 2),
    );
    drawBoard(tctx, state, { cell_px, show_ghost: false, palette: palette() });
    tctx.restore();
  }

  function outcomeFor(payload: Params): OutcomeBanner | null {
    const outcome = payload["outcome"];
    const lines = typeof payload["lines"] === "number" ? payload["lines"] : 0;
    if (outcome === "won") {
      return {
        status: "won",
        title: "Cleared",
        body: `${lines} lines — the well audits a clean stack.`,
      };
    }
    if (outcome === "lost") {
      return {
        status: "lost",
        title: "Topped out",
        body: `The stack reached the spawn row after ${lines} cleared lines.`,
      };
    }
    return null;
  }

  return {
    unmount: () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      tree_canvas.removeEventListener("click", onTreeClick);
      if (root.parentNode === container) container.removeChild(root);
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    snapshot: () => board_canvas,
    renderThumbnail,
    commitGlyph,
    outcomeFor,
    hudMetrics: () => {
      const s = history.substrate.read;
      return [
        { id: "lines", label: "lines", value: String(s.lines) },
        { id: "pieces", label: "pieces", value: String(s.spawn_count) },
        { id: "hash", label: "hash", value: hashState(s).slice(0, 4) },
      ];
    },
    pause: () => {
      useStore.getState().setPlaying(false);
    },
    resume: () => {
      useStore.getState().setPlaying(true);
    },
    step: () => {
      useStore.getState().setPlaying(false);
      doOneTick();
    },
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
  };
}

export const pentrisLens: Lens<
  SubstrateState,
  PentrisConfig,
  PentrisInputs,
  PentrisCommitPayload
> = {
  id: "pentris-workbench",
  name: "Workbench",
  tunables: TUNABLES,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "dom",
  // AUTOPLAY — rAF drives ticks (Q5). BOUNDED — the lens sizes its own
  // three-column host (Q2). (No SINGLE_BRANCH: runs carry recorded
  // per-tick input, and column C exists to fork them.)
  features: ["AUTOPLAY", "BOUNDED"],
  theme: { accent: ACCENT },
  mount: mountPentris,
};
