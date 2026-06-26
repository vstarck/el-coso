/* tfps lens — "raycast". The forward operator is a Wolfenstein-style raycaster:
 * State (a camera pose) → 120 columns of ASCII drawn onto a canvas, dressed in
 * the terminal/CRT kit for the Akira-arcade look. Self-plays on load (a patrol
 * bot); press the arrow keys to take the controls.
 *
 *   Q1 — render target?    a <canvas> (ASCII glyphs drawn into it, 120 wide).
 *   Q2 — viewport relation? BOUNDED — the lens sizes its own 720×540 screen.
 *   Q3 — storage?          plain-object camera State (no channels).
 *   Q4 — agency?           held arrows: ▲▼ move, ◄► turn, ,/. strafe.
 *   Q5 — pace?             autonomous (tick + speedMult; host owns rAF).
 *   Q6 — commit shape?     heartbeat — a commit per second; glyph = a compass.
 *
 * Talks to its host only through the injected LensHost, so it exports React-free.
 */

import { historyReset, historyTick } from "@/history";
import type { Params, SpeedOption } from "@/lib/types";
import type {
  Cadence,
  CommitGlyph,
  EmbedCommandSpec,
  HudMetric,
  Lens,
  LensMountArgs,
  LensTunable,
  MountedLens,
  TunableValue,
} from "@/lenses/types";
import {
  mountCrtScreen,
  mountTerminal,
} from "@/lib/terminal";
import type {
  TfpsCommitPayload,
  TfpsConfig,
  TfpsInputs,
  SubstrateState,
} from "../engine";
import { COMMIT_PERIOD } from "../engine";
import { castColumns } from "./raycast";
import { botInputs } from "./bot";
import { attachInput } from "./input";
import {
  drawSurface,
  makeViewSurface,
  paintMinimap,
  paintScene,
  type ViewDims,
} from "./render";
import { DEFAULT_THEME, resolveTheme, THEMES } from "./theme";

// The screen footprint (CSS px) — 4:3, the classic arcade-cabinet aspect. The
// projection plane is derived from it so the raycast is undistorted.
const SCREEN_W = 720;
const SCREEN_H = 540;
const PLANE_MAG = SCREEN_W / (2 * SCREEN_H); // ≈ 0.667 → ~67° FOV

// The ASCII grid: 120 columns (one ray each, as asked), 45 rows. Cells render
// ~2:1 tall (terminal-like) into the 4:3 canvas.
const DIMS: ViewDims = { cols: 120, rows: 45 };

// Cap device-pixel-ratio so a hi-dpi screen doesn't quadruple the glyph draws.
const MAX_DPR = 2;

const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1, isDefault: true },
  { id: "2x", label: "2x", mult: 2 },
];

const CADENCE: Cadence = {
  sampling_rate: { kind: "every-frame" },
  pause_condition: { kind: "never" },
  bias_apply: { kind: "immediate" },
};

const TUNABLES: LensTunable[] = [
  {
    id: "theme",
    group: "Lens",
    label: "Theme",
    type: "enum",
    options: Object.keys(THEMES),
    target: "lens",
    path: ["theme"],
  },
];

const AUTOPILOT_DEFAULT_ON = true;
const HELP_DEFAULT_ON = true;

type Command = {
  name: string;
  aliases?: string[];
  help?: string;
  run(args: string[]): void;
};

function buildHelpText(commands: Command[]): string {
  const listed = commands.filter((c) => c.help);
  const labels = listed.map((c) => [c.name, ...(c.aliases ?? [])].join(", "));
  const width = Math.max(0, ...labels.map((l) => l.length));
  return [
    "commands:",
    ...listed.map((c, i) => `  ${labels[i]!.padEnd(width)}   ${c.help}`),
  ].join("\n");
}

const COMMAND_SPECS: EmbedCommandSpec[] = [
  { name: "restart", label: "back to spawn" },
  { name: "auto", label: "toggle self-play" },
  { name: "pause", label: "stop the clock" },
  { name: "play", label: "resume" },
  { name: "theme", label: "set theme", args: [{ name: "name", type: "string" }] },
  { name: "map", label: "toggle minimap" },
  { name: "help", label: "toggle command list" },
];

function headingDeg(angle: number): number {
  return Math.round((((angle * 180) / Math.PI) % 360 + 360) % 360);
}

function mountTfps(
  args: LensMountArgs<SubstrateState, TfpsConfig, TfpsInputs, TfpsCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;
  const config = history.config;

  // --- CRT frame (terminal kit) — gives the focusable screen, scanlines,
  // wobble, background + the command line below the view.
  const crt = mountCrtScreen(container, {
    width: SCREEN_W,
    classPrefix: "tfps",
    ariaLabel: "tfps view",
  });

  // --- The 3D view canvas, prepended above the command-line <pre> ----------
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = `${SCREEN_W}px`;
  canvas.style.height = `${SCREEN_H}px`;
  const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(SCREEN_W * dpr);
  canvas.height = Math.round(SCREEN_H * dpr);
  crt.root.prepend(canvas);

  const surface = makeViewSurface(DIMS);

  // --- Run state -----------------------------------------------------------
  let autopilot = AUTOPILOT_DEFAULT_ON;
  let help_shown = HELP_DEFAULT_ON;
  let map_shown = true; // the top-right minimap HUD
  let speed_mult = 1;
  let last_tick = -1;
  const lens_state: Record<string, string> = { theme: DEFAULT_THEME };

  function theme() {
    return resolveTheme(lens_state.theme ?? DEFAULT_THEME);
  }
  function applyTheme(): void {
    const t = theme();
    crt.setColor(t.accent);
    crt.setBackground(t.bg);
    crt.setEnabled(t.crt);
    canvas.style.filter = t.crt ? "saturate(1.3) brightness(1.05)" : "none";
    last_tick = -1; // repaint with the new palette even if the clock is frozen
  }

  // --- Commands ------------------------------------------------------------
  function renderHelp(): void {
    term.print(help_shown ? buildHelpText(COMMANDS) : "");
  }
  function setAuto(on: boolean): void {
    autopilot = on;
    last_tick = -1;
    if (on) host.setPlaying(true);
  }
  function restartRun(): void {
    historyReset(history);
    autopilot = AUTOPILOT_DEFAULT_ON;
    help_shown = HELP_DEFAULT_ON;
    last_tick = -1;
    term.reset();
    renderHelp();
    host.setPlayheadTick(0);
    host.bumpHistoryVersion();
    host.setPlaying(true);
  }
  const COMMANDS: Command[] = [
    { name: "restart", help: "back to spawn", run: restartRun },
    { name: "auto", help: "toggle self-play", run: () => setAuto(!autopilot) },
    { name: "pause", help: "stop the clock", run: () => host.setPlaying(false) },
    {
      name: "play",
      aliases: ["unpause"],
      help: "resume",
      run: () => host.setPlaying(true),
    },
    {
      name: "theme",
      help: `theme NAME — ${Object.keys(THEMES).join(" · ")}`,
      run: (a) => setTunable(["theme"], a[0] ?? ""),
    },
    { name: "map", help: "toggle minimap", run: () => {
      map_shown = !map_shown;
      last_tick = -1;
    } },
    { name: "help", help: "toggle this list", run: () => {
      help_shown = !help_shown;
      renderHelp();
    } },
  ];
  const commandIndex = new Map<string, Command>();
  for (const cmd of COMMANDS) {
    commandIndex.set(cmd.name, cmd);
    for (const alias of cmd.aliases ?? []) commandIndex.set(alias, cmd);
  }

  const term = mountTerminal(crt.text, {
    keyTarget: crt.root,
    classPrefix: "tfps",
    launchCommand: "npm run tfps",
    onCommand: (line) => {
      const [name, ...rest] = line.toLowerCase().split(/\s+/);
      if (name) commandIndex.get(name)?.run(rest);
    },
  });
  renderHelp();
  applyTheme();

  // --- Input: arrows take control from the bot -----------------------------
  const playerInput = attachInput(crt.root, () => {
    if (autopilot) setAuto(false);
    host.setPlaying(true);
  });

  // --- Tunables ------------------------------------------------------------
  const tunableListeners = new Set<() => void>();
  function getTunable(path: string[]): TunableValue | undefined {
    return path.length === 1 ? lens_state[path[0] ?? ""] : undefined;
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if (key === "theme" && typeof value === "string" && value in THEMES) {
      lens_state.theme = value;
      applyTheme();
      for (const cb of tunableListeners) cb();
    }
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  // --- Tick (autonomous) ---------------------------------------------------
  function doOneTick(): void {
    const input = autopilot
      ? botInputs(config, history.substrate.read)
      : playerInput.drain();
    historyTick(history, input);
    const st = history.substrate.read;
    host.setPlayheadTick(st.tick);
    if (st.tick % COMMIT_PERIOD === 0) host.bumpHistoryVersion();
  }

  // --- Render --------------------------------------------------------------
  function hudLine(s: SubstrateState): string {
    const mode = autopilot ? "AUTO" : "PLAYER";
    const pos = `${s.px.toFixed(1)},${s.py.toFixed(1)}`;
    return ` TFPS · ${config.id.toUpperCase()}   ${mode}   POS ${pos}  HDG ${headingDeg(s.angle)}°   ◄► turn  ▲▼ move`;
  }
  function renderFrom(state: SubstrateState): void {
    if (state.tick === last_tick) return;
    last_tick = state.tick;
    const cols = castColumns(
      config,
      state.px,
      state.py,
      state.angle,
      PLANE_MAG,
      DIMS.cols,
    );
    paintScene(surface, { cols, theme: theme(), hud: hudLine(state) });
    if (map_shown) {
      paintMinimap(surface, {
        config,
        px: state.px,
        py: state.py,
        angle: state.angle,
        theme: theme(),
      });
    }
    drawSurface(surface, canvas, theme().bg);
  }

  // --- Timeline vocabulary -------------------------------------------------
  function commitGlyph(payload: Params): CommitGlyph {
    const angle = typeof payload["angle"] === "number" ? payload["angle"] : 0;
    const deg = headingDeg(angle);
    const dir =
      deg < 45 || deg >= 315
        ? "right"
        : deg < 135
          ? "down"
          : deg < 225
            ? "left"
            : "up";
    return { kind: "arrow", dir, color: theme().accent };
  }

  function hudMetrics(): HudMetric[] {
    const s = history.substrate.read;
    return [
      { id: "mode", label: "mode", value: autopilot ? "auto" : "player" },
      { id: "hdg", label: "hdg", value: `${headingDeg(s.angle)}°` },
      { id: "pos", label: "pos", value: `${s.px.toFixed(1)},${s.py.toFixed(1)}` },
    ];
  }

  return {
    unmount: () => {
      playerInput.detach();
      term.destroy();
      if (canvas.parentNode === crt.root) crt.root.removeChild(canvas);
      crt.destroy();
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    snapshot: () => canvas,
    commitGlyph,
    hudMetrics,
    pause: () => host.setPlaying(false),
    resume: () => host.setPlaying(true),
    step: () => {
      host.setPlaying(false);
      doOneTick();
    },
    reset: restartRun,
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
    command: (name, cmdArgs) => {
      const cmd = commandIndex.get(String(name).toLowerCase());
      if (!cmd) throw new Error(`tfps: unknown command "${name}"`);
      cmd.run(cmdArgs.map((a) => String(a)));
    },
  };
}

export const tfpsLens: Lens<
  SubstrateState,
  TfpsConfig,
  TfpsInputs,
  TfpsCommitPayload
> = {
  id: "tfps-raycast",
  name: "raycast",
  tunables: TUNABLES,
  commands: COMMAND_SPECS,
  speeds: SPEEDS,
  cadence: CADENCE,
  // A canvas (ASCII glyphs are drawn into it). BOUNDED ⇒ no chrome perspective.
  target_kind: "canvas2d",
  features: ["AUTOPLAY", "BOUNDED"],
  theme: { accent: THEMES[DEFAULT_THEME]!.accent },
  mount: mountTfps,
};
