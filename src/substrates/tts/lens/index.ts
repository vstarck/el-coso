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
  DEFAULT_PROMPT,
  mountCrtScreen,
  THEMES,
  DEFAULT_THEME,
} from "@/lib/terminal";
import { withConsole } from "@/lenses/withConsole";
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
  // Autopilot is a bool tunable (not just a command) so a host control — the
  // portfolio's auto toggle — can READ it and stay in sync when the substrate
  // flips it (spec/25 live-state). `setTunable(["autopilot"], …)` routes to
  // `setAuto`; the `auto` command is the typed alias.
  {
    id: "autopilot",
    group: "Lens",
    label: "Self-play",
    type: "bool",
    target: "lens",
    path: ["autopilot"],
  },
];

// Autopilot is on by default — tts self-plays on load (the embed's feed-post
// behavior). Type `auto` to take over; `restart` returns to self-play.
const AUTOPILOT_DEFAULT_ON = true;

// tts's OWN console verbs (spec/26). Transport (play/pause/step/speed),
// `set theme`, `describe`, and `help` come free as console built-ins (the
// inline terminal drives the same registry as the guake console), so only the
// substrate-specific verbs are declared here. `theme` stays as a friendly alias
// for `set theme`. `command(name, args)` in the returned MountedLens throws on
// an unknown name (the console surfaces it).
const COMMAND_SPECS: EmbedCommandSpec[] = [
  { name: "restart", label: "start a new game" },
  { name: "auto", label: "toggle self-play" },
  {
    name: "rewind",
    label: "rewind N pieces",
    args: [{ name: "n", type: "number" }],
  },
  {
    name: "theme",
    label: `set theme (${Object.keys(THEMES).join(" · ")})`,
    args: [{ name: "name", type: "string" }],
  },
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

  // Static terminal: the launch header + the live JSON body, dressed as a fish
  // session but non-interactive. Commands live in the guake console (withConsole
  // at the bottom; backtick drops it down) — keeping the resting embed compact
  // for a feed post instead of an always-on command line.
  crt.text.textContent = "";
  const header = document.createTextNode(`${DEFAULT_PROMPT}npm run tts\n`);
  const bodyEl = document.createElement("span");
  crt.text.append(header, bodyEl);

  // Autopilot (the `auto` command): while on, the tick loop feeds the piece
  // `pilot.inputs(state)` instead of the keyboard (a paced greedy player; see
  // ./autopilot). `autopilot` is just the on/off mode flag.
  let autopilot = AUTOPILOT_DEFAULT_ON;
  const pilot = makeAutopilot(history.rng.seed);

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
  function notifyTunables(): void {
    for (const cb of tunableListeners) cb();
  }
  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length !== 1) return undefined;
    const key = path[0] ?? "";
    if (key === "font_size") return font_px;
    if (key === "autopilot") return autopilot;
    return lens_state[key];
  }
  function setTunable(path: string[], value: TunableValue): void {
    const key = path.length === 1 ? path[0] : undefined;
    if (key === "autopilot" && typeof value === "boolean") {
      setAuto(value); // notifies itself
      return;
    }
    if (key === "theme" && typeof value === "string" && value in THEMES) {
      lens_state.theme = value;
      applyTheme();
    } else if (key === "font_size" && typeof value === "number" && value > 0) {
      font_px = Math.max(6, Math.min(96, value));
      crt.setFontSize(font_px);
    } else {
      return;
    }
    notifyTunables();
  }
  function subscribeTunables(listener: () => void): () => void {
    tunableListeners.add(listener);
    return () => tunableListeners.delete(listener);
  }

  // --- Commands -----------------------------------------------------------
  // The readout shows `auto`/`paused`; a frozen clock won't re-render on its
  // own, so a command that changes those fields resets last_tick to force one
  // re-stringify next frame.
  let last_tick = -1;
  function restartGame(): void {
    // Carry an explicit pause through the restart: if the player paused a game
    // that's still in progress, the fresh game resets but stays paused (the
    // clock doesn't restart). Restarting from a finished game (topped out /
    // cleared) starts playing, as a "play again" should.
    const stayPaused =
      !host.isPlaying() && history.substrate.read.outcome === "in_progress";
    historyReset(history);
    autopilot = AUTOPILOT_DEFAULT_ON;
    pilot.reset(); // same paced run after a restart
    last_tick = -1; // forces the static body to re-render the fresh state
    host.setPlayheadTick(0);
    host.bumpHistoryVersion();
    host.setPlaying(!stayPaused);
  }
  function setAuto(on: boolean): void {
    if (on === autopilot) return; // no-op ⇒ no spurious notify
    autopilot = on;
    pilot.replan();
    last_tick = -1;
    if (on) host.setPlaying(true);
    notifyTunables(); // keep host controls (the auto toggle) in sync
  }
  // `rewind N` — take back the last N locked pieces. Each commit is one piece
  // lock, so we truncate the active branch to the commit N back (clamped to the
  // branch start), which re-anchors the substrate there and discards the
  // future. Pause + autopilot state are deliberately left untouched.
  function rewindGame(n: number): void {
    const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    const branch = historyActiveBranch(history);
    if (branch.commits.length === 0) return; // no locked piece to take back
    const target_index = branch.commits.length - 1 - count;
    const target_tick =
      target_index >= 0 ? branch.commits[target_index]!.tick : branch.fork_tick;
    historyTruncate(history, branch.id, target_tick);
    pilot.replan(); // autopilot re-picks a landing for the now-current piece
    last_tick = -1; // force a re-render of the rewound state
    host.setPlayheadTick(history.substrate.read.tick);
    host.bumpHistoryVersion();
  }

  // Console dispatch (spec/26) — tts's own verbs only. Transport + `set theme`
  // are built-ins. Throws on an unknown name / theme; the console surfaces it.
  function command(name: string, cmdArgs: unknown[]): void {
    switch (name) {
      case "restart":
        restartGame();
        break;
      case "auto":
        setAuto(!autopilot);
        break;
      case "rewind":
        rewindGame(typeof cmdArgs[0] === "number" ? cmdArgs[0] : 1);
        break;
      case "theme": {
        const themeName = String(cmdArgs[0] ?? "");
        if (!(themeName in THEMES)) {
          throw new Error(
            `unknown theme: ${themeName} — try ${Object.keys(THEMES).join(" / ")}`,
          );
        }
        setTunable(["theme"], themeName);
        break;
      }
      default:
        throw new Error(`tts: unknown command "${name}"`);
    }
  }

  // --- Input (Q4): held move + tap rotate/drop --------------------------
  // Element-scoped to the focusable CRT screen. Commands go through the guake
  // console (window-capture), which swallows keys only while open — so arrows
  // play the game when it's closed and type commands when it's open.
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
  function renderFrom(state: SubstrateState): void {
    if (state.tick === last_tick) return;
    last_tick = state.tick;
    bodyEl.textContent = renderJson(state, {
      auto: autopilot,
      paused: !host.isPlaying(),
    });
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

  const mounted: MountedLens<SubstrateState> = {
    unmount: () => {
      playerInput.detach();
      crt.destroy();
    },
    renderFrom,
    tick: doOneTick,
    speedMult: () => speed_mult,
    commitGlyph,
    outcomeFor,
    hudMetrics,
    pause: () => {
      host.setPlaying(false);
      last_tick = -1;
    },
    resume: () => {
      host.setPlaying(true);
      last_tick = -1;
    },
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
    command,
    // The `play`/`pause` console built-ins flip `host.setPlaying` but don't
    // touch `last_tick`, so the readout's `paused` field would lag a frozen
    // clock. Wrap them to refresh it (spec/26 interceptor; tts's own verbs
    // already reset last_tick themselves and are not built-ins).
    interceptCommand: (name, _args, next) => {
      const result = next();
      if (name === "play" || name === "pause") last_tick = -1;
      return result;
    },
  };

  return mounted;
}

const ttsLensBase: Lens<
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

// The static readout above + the guake console for commands: backtick drops a
// fish-prompt terminal over the screen (built-ins + restart/auto/rewind/theme).
// Empty banner — no help list auto-shown; type `help` to list commands. This
// keeps the resting embed compact (the always-on command line made it ~950px).
export const ttsLens = withConsole(ttsLensBase, {
  description: "simplest-possible Tetris, as a terminal session",
  banner: "",
});
