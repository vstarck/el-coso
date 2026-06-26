/* tts lens — "JSON". The lens is literally a plain-JSON view of the
 * substrate state, pretty-printed into a <pre> that re-renders each tick: a
 * terminal-style readout where the board is a character grid (one letter per
 * tetromino). The whole look is a single themable entity (text color, terminal
 * background, CRT on/off).
 *
 *   Q1 — render target?    dom (a single <pre>).
 *   Q2 — viewport relation? BOUNDED — 640px-wide host, height grows with the
 *                            readout (no height constraint).
 *   Q3 — storage?          one doubled Uint8Array channel + piece scalars.
 *   Q4 — agency?           held left/right move, Up rotates, Down/Space drop.
 *   Q5 — pace?             autonomous (tick + speedMult; host owns rAF).
 *   Q6 — commit shape?     per-event — a commit per piece lock; the glyph is
 *                            the tetromino's letter.
 *
 * Talks to its host only through the injected `LensHost` (no `@/app/store`),
 * so the export pipeline bundles it React-free.
 */

import {
  historyActiveBranch,
  historyReset,
  historyTick,
  historyTruncate,
} from "@/history";
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
  OutcomeBanner,
  TunableValue,
} from "@/lenses/types";
import type {
  TtsCommitPayload,
  TtsConfig,
  TtsInputs,
  SubstrateState,
} from "../engine";
import { renderJson } from "./render";
import {
  CRT_DEFAULT_FONT_PX,
  mountCrtScreen,
  mountTerminal,
  THEMES,
  DEFAULT_THEME,
} from "@/lib/terminal";
import { makeAutopilot } from "./autopilot";
import { attachInput } from "./input";

// Render envelope: target width is 640px (the embed footprint); the readout
// flows top-to-bottom inside it with no height cap (BOUNDED, height: auto).
const TARGET_W = 640;

const SPEEDS: SpeedOption[] = [
  { id: "0.5x", label: "½x", mult: 0.5 },
  { id: "1x", label: "1x", mult: 1, isDefault: true },
  { id: "2x", label: "2x", mult: 2 },
  { id: "4x", label: "4x", mult: 4 },
];

// Autonomous: ticks at a steady rate while playing, never auto-pauses, biases
// (input) apply immediately.
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

// Autopilot is on by default — tts self-plays on load (the embed's feed-post
// behavior). Type `auto` to take over; `restart` returns to self-play.
const AUTOPILOT_DEFAULT_ON = true;

// The command list shows on launch (and after a restart) so the embed is
// self-documenting. Type `help` to dismiss it.
const HELP_DEFAULT_ON = true;

// One typed terminal command. The `COMMANDS` table (built inside the mount,
// where the handlers can close over run state) is the single place a command
// is declared — it drives both dispatch and the `help` list, so adding or
// removing one is a one-line edit and the help text can't drift from what
// actually runs.
type Command = {
  /** Canonical name typed at the prompt. */
  name: string;
  /** Alternate names that run the same command. */
  aliases?: string[];
  /** One-line description for the `help` list. Omit to keep the command working
   *  but unlisted. */
  help?: string;
  /** Args are the whitespace-split tokens after the command name (`rewind 5` →
   *  `["5"]`); argument-less commands just ignore them. */
  run(args: string[]): void;
};

// Render the `help` list from a command table — aligned to the widest
// name/alias label so a new command needs no manual spacing.
function buildHelpText(commands: Command[]): string {
  const listed = commands.filter((c) => c.help);
  const labels = listed.map((c) => [c.name, ...(c.aliases ?? [])].join(", "));
  const width = Math.max(0, ...labels.map((l) => l.length));
  const lines = listed.map(
    (c, i) => `  ${labels[i]!.padEnd(width)}   ${c.help}`,
  );
  return ["commands:", ...lines].join("\n");
}

// Discovery manifest for the embed SDK (spec/25) — the public command surface.
// Names mirror the in-mount `COMMANDS` table (dispatch routes through it); this
// static list is what a host enumerates to build controls. `command(name, args)`
// in the returned MountedLens throws on an unknown name (never a silent no-op,
// unlike the terminal's tolerant `?.run`).
const COMMAND_SPECS: EmbedCommandSpec[] = [
  { name: "restart", label: "start a new game" },
  { name: "auto", label: "toggle self-play" },
  { name: "pause", label: "stop the clock" },
  { name: "play", label: "resume" },
  { name: "rewind", label: "rewind N pieces", args: [{ name: "n", type: "number" }] },
  { name: "theme", label: "set theme", args: [{ name: "name", type: "string" }] },
  { name: "help", label: "toggle command list" },
];

function mountTts(
  args: LensMountArgs<SubstrateState, TtsConfig, TtsInputs, TtsCommitPayload>,
): MountedLens<SubstrateState> {
  const { container, history, host } = args;

  // --- DOM (Q1: dom) — the CRT screen owns the <pre> text surface, the
  // scanline overlay, and its stylesheet (see ./crt). 640px wide, no canvas.
  const crt = mountCrtScreen(container, {
    width: TARGET_W,
    classPrefix: "tts",
    ariaLabel: "tts state",
  });

  // Autopilot (the `auto` command): while on, the tick loop feeds the piece
  // `pilot.inputs(state)` instead of the keyboard (a paced greedy player; see
  // ./autopilot). `autopilot` is just the on/off mode flag.
  let autopilot = AUTOPILOT_DEFAULT_ON;
  const pilot = makeAutopilot(history.rng.seed);
  // `help` toggles the command list into the terminal's output area; it starts
  // shown (HELP_DEFAULT_ON) so the launch screen documents itself.
  let help_shown = HELP_DEFAULT_ON;

  // pause / play / auto change lens-level flags the readout shows; force the
  // next render (the tick may be frozen) so the JSON reflects them at once.
  function pauseGame(): void {
    host.setPlaying(false);
    last_tick = -1;
  }
  function resumeGame(): void {
    host.setPlaying(true);
    last_tick = -1;
  }
  function restartGame(): void {
    // Carry an explicit pause through the restart: if the player paused a game
    // that's still in progress, the fresh game resets but stays paused (the
    // clock doesn't restart). Restarting from a finished game (topped out /
    // cleared) starts playing, as a "play again" should.
    const stayPaused =
      !host.isPlaying() &&
      history.substrate.read.outcome === "in_progress";
    historyReset(history);
    autopilot = AUTOPILOT_DEFAULT_ON;
    pilot.reset(); // same paced run after a restart
    help_shown = HELP_DEFAULT_ON;
    last_tick = -1;
    term.reset(); // clears the output area; renderHelp() re-shows help below
    renderHelp();
    host.setPlayheadTick(0);
    host.bumpHistoryVersion();
    host.setPlaying(!stayPaused);
  }
  // Print the help list (or clear it) to match `help_shown`. Shared by the
  // initial launch, the `help` toggle, and the post-restart re-launch.
  function renderHelp(): void {
    term.print(help_shown ? buildHelpText(COMMANDS) : "");
  }
  function toggleHelp(): void {
    help_shown = !help_shown;
    renderHelp();
  }
  function setAuto(on: boolean): void {
    autopilot = on;
    pilot.replan();
    last_tick = -1;
    if (on) host.setPlaying(true);
  }
  // `rewind N` — take back the last N locked pieces. Each commit is one piece
  // lock, so we truncate the active branch to the commit N back (clamped to the
  // branch start), which re-anchors the substrate there and discards the
  // future. Pause + autopilot state are deliberately left untouched: a rewind
  // keeps playing if you were playing, stays paused if you were paused.
  function rewindGame(args: string[]): void {
    const requested = Number.parseInt(args[0] ?? "", 10);
    const n = Number.isFinite(requested) && requested > 0 ? requested : 1;
    const branch = historyActiveBranch(history);
    if (branch.commits.length === 0) return; // no locked piece to take back
    const target_index = branch.commits.length - 1 - n;
    const target_tick =
      target_index >= 0 ? branch.commits[target_index]!.tick : branch.fork_tick;
    historyTruncate(history, branch.id, target_tick);
    pilot.replan(); // autopilot re-picks a landing for the now-current piece
    last_tick = -1; // force a re-render of the rewound state
    host.setPlayheadTick(history.substrate.read.tick);
    host.bumpHistoryVersion();
  }

  // The command table — single source of truth for dispatch *and* `help`.
  // Each handler closes over the run state above; `commandIndex` resolves
  // names + aliases for the prompt.
  const COMMANDS: Command[] = [
    { name: "restart", help: "start a new game", run: restartGame },
    { name: "auto", help: "toggle self-play", run: () => setAuto(!autopilot) },
    { name: "pause", help: "stop the clock", run: pauseGame },
    { name: "play", aliases: ["unpause"], help: "resume", run: resumeGame },
    { name: "rewind", help: "rewind N pieces", run: rewindGame },
    {
      name: "theme",
      help: `theme NAME — ${Object.keys(THEMES).join(" · ")}`,
      run: (args) => setTunable(["theme"], args[0] ?? ""),
    },
    { name: "help", help: "toggle this list", run: toggleHelp },
  ];
  const commandIndex = new Map<string, Command>();
  for (const cmd of COMMANDS) {
    commandIndex.set(cmd.name, cmd);
    for (const alias of cmd.aliases ?? []) commandIndex.set(alias, cmd);
  }

  // Shell furniture inside the screen: launch line, JSON body, command line.
  // Command effects surface in the readout itself (the `auto` / `paused`
  // fields), not as separate output — `help` is the one exception (it prints
  // into the output area).
  const term = mountTerminal(crt.text, {
    keyTarget: crt.root,
    classPrefix: "tts",
    launchCommand: "npm run tts",
    onCommand: (line) => {
      const [name, ...args] = line.toLowerCase().split(/\s+/);
      if (name) commandIndex.get(name)?.run(args);
    },
  });
  renderHelp(); // show the command list on launch (HELP_DEFAULT_ON)

  // --- Tunables: theme (text color + background + CRT) -----------------
  const lens_state: Record<string, string> = {
    theme: DEFAULT_THEME,
  };
  // `font_size` is an embed-only tunable: settable via the export (`--set
  // font_size=24`) but deliberately absent from `TUNABLES`, so it never shows
  // in chrome. The mount pipeline still routes the undeclared path here.
  let font_px = CRT_DEFAULT_FONT_PX;
  const tunableListeners = new Set<() => void>();
  // Apply the current theme — its three knobs map onto the CRT screen's color,
  // background, and master CRT switch.
  function applyTheme(): void {
    const theme =
      THEMES[lens_state.theme ?? DEFAULT_THEME] ?? THEMES[DEFAULT_THEME]!;
    crt.setColor(theme.text);
    crt.setBackground(theme.background);
    crt.setEnabled(theme.crt);
  }
  applyTheme();
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0] ?? "";
    if (key === "font_size") return font_px;
    return lens_state[key];
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if (key === "theme" && typeof value === "string" && value in THEMES) {
      lens_state.theme = value;
      applyTheme();
    } else if (key === "font_size" && typeof value === "number" && value > 0) {
      font_px = Math.max(6, Math.min(96, value));
      crt.setFontSize(font_px);
    } else {
      return;
    }
    for (const cb of tunableListeners) cb();
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  // --- Input (Q4): held move + tap rotate/drop --------------------------
  // Element-scoped keyboard (see ./input): only the focused sandbox plays, so
  // several embeds can share a page without trading keystrokes.
  const playerInput = attachInput(crt.root);

  // --- Tick loop (Q5: autonomous, live-only) ----------------------------
  let speed_mult = 1;

  function doOneTick(): void {
    // Terminal ⇒ rest on the outcome commit; stop driving the loop.
    if (history.substrate.read.outcome !== "in_progress") {
      host.setPlaying(false);
      return;
    }
    const before_spawn = history.substrate.read.spawn_count;
    const input = autopilot
      ? pilot.inputs(history.substrate.read)
      : playerInput.drain();
    historyTick(history, input);
    const st = history.substrate.read;
    host.setPlayheadTick(st.tick);
    // The tree changes exactly when a piece locks or the run ends.
    if (st.spawn_count !== before_spawn || st.outcome !== "in_progress") {
      host.bumpHistoryVersion();
    }
  }

  // --- Render: re-stringify on each new tick ----------------------------
  let last_tick = -1;
  function renderFrom(state: SubstrateState): void {
    if (state.tick === last_tick) return;
    last_tick = state.tick;
    term.setBody(
      renderJson(state, { auto: autopilot, paused: !host.isPlaying() }),
    );
  }

  // --- Timeline vocabulary ----------------------------------------------
  function commitGlyph(payload: Params): CommitGlyph {
    const outcome = payload["outcome"];
    if (outcome === "won") return { kind: "char", char: "🏁" };
    if (outcome === "lost") return { kind: "char", char: "✕" };
    const piece = payload["piece"];
    return { kind: "char", char: typeof piece === "string" ? piece : "·" };
  }

  function outcomeFor(payload: Params): OutcomeBanner | null {
    const outcome = payload["outcome"];
    const lines = typeof payload["lines"] === "number" ? payload["lines"] : 0;
    if (outcome === "won") {
      return {
        status: "won",
        title: "Cleared",
        body: `${lines} lines cleared.`,
      };
    }
    // Topping out shows no chrome modal — the readout's `status: topped out`
    // (and the timeline glyph) carries it; a self-playing demo shouldn't pop
    // an interrupting dialog.
    return null;
  }

  function hudMetrics(): HudMetric[] {
    const s = history.substrate.read;
    return [
      { id: "lines", label: "lines", value: String(s.lines) },
      { id: "pieces", label: "pieces", value: String(s.spawn_count) },
    ];
  }

  return {
    unmount: () => {
      playerInput.detach();
      term.destroy();
      crt.destroy();
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    commitGlyph,
    outcomeFor,
    hudMetrics,
    pause: () => host.setPlaying(false),
    resume: () => host.setPlaying(true),
    step: () => {
      host.setPlaying(false);
      doOneTick();
    },
    setSpeed: (id: string) => {
      const opt = SPEEDS.find((s) => s.id === id);
      if (opt) speed_mult = opt.mult;
    },
    getTunable,
    setTunable,
    subscribeTunables,
    // Embed SDK (spec/25): route a named command through the same table the
    // terminal uses. Unknown name THROWS (the SDK surfaces it) — not the
    // terminal's tolerant silent skip.
    command: (name, cmdArgs) => {
      const cmd = commandIndex.get(String(name).toLowerCase());
      if (!cmd) throw new Error(`tts: unknown command "${name}"`);
      cmd.run(cmdArgs.map((a) => String(a)));
    },
  };
}

export const ttsLens: Lens<
  SubstrateState,
  TtsConfig,
  TtsInputs,
  TtsCommitPayload
> = {
  id: "tts-json",
  name: "JSON",
  tunables: TUNABLES,
  commands: COMMAND_SPECS,
  speeds: SPEEDS,
  cadence: CADENCE,
  target_kind: "dom",
  // AUTOPLAY — rAF drives gravity (Q5). BOUNDED — the lens sizes its own
  // 640px host (Q2). (No SINGLE_BRANCH: runs carry recorded per-tick input.)
  features: ["AUTOPLAY", "BOUNDED"],
  theme: { accent: THEMES[DEFAULT_THEME]!.text },
  mount: mountTts,
};
