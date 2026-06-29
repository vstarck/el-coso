/* Terminal-kit inline terminal — an ALWAYS-VISIBLE shell session rendered inside
 * a CRT screen's <pre>, powered by the render-free shell core (`shell.ts`,
 * spec/26). Unlike the guake `mountConsole` (a toggled drop-down overlay), this
 * is the substrate's own surface — the readout and the command line are one
 * continuous session:
 *
 *     ⋊> ~ npm run <game>      ← the command that "ran" the game (header)
 *     { ...state readout... }   ← the live body, rewritten each tick (setBody)
 *     commands: …               ← shell scrollback (the launch banner, echoes,
 *     ⋊> ~ theme amber             command results — grows as you type)
 *     theme = amber
 *     ⋊> ~ ▮                     ← the live command line (prompt + typed + cursor)
 *
 * It drives the SAME shell core as the guake console, so a substrate gets the
 * command registry (built-ins + its own verbs), `help`, and Tab-completion for
 * free. The difference is presentation + input discipline: always-on (no
 * toggle), and element-scoped + typing-only — letters/digits/Enter/Backspace/Tab
 * and a mid-command Space go to the command line, while arrows and a leading
 * Space stay with the lens (gameplay). The keydown listens on `keyTarget` (the
 * focusable CRT screen), so only the focused sandbox types.
 *
 * Built inside the CRT screen's text surface, so the blur / glow / wobble all
 * cascade onto it for free. Class names + keyframe are scoped by `classPrefix`.
 */

import {
  createShell,
  DEFAULT_PROMPT,
  type CommandSource,
  type StyleToken,
  type TermEvent,
} from "./shell";

const CURSOR_GLYPH = "█";
const BLINK_MS = 1000;

// Keys that type into the command line. Gameplay keys (arrows, leading space)
// are deliberately excluded so they stay with the lens.
const TYPING_KEY = /^[a-zA-Z0-9-]$/;

function termNames(prefix: string) {
  return {
    cursor: `${prefix}-term-cursor`,
    body: `${prefix}-term-body`,
    scrollback: `${prefix}-term-scrollback`,
    prompt: `${prefix}-term-prompt`,
    blinkKeyframe: `${prefix}-term-blink`,
    // Style-token classes (shell.ts StyleToken). `output` is the bare default.
    echo: `${prefix}-term-echo`,
    error: `${prefix}-term-error`,
    unknown: `${prefix}-term-unknown`,
    known: `${prefix}-term-known`,
    arg: `${prefix}-term-arg`,
    ghost: `${prefix}-term-ghost`,
  };
}

// Map a style token to its scoped class (or "" for the bare-default `output`).
function tokenClass(n: ReturnType<typeof termNames>, style: StyleToken): string {
  switch (style) {
    case "echo":
      return n.echo;
    case "error":
      return n.error;
    case "unknown-cmd":
      return n.unknown;
    case "known-cmd":
      return n.known;
    case "arg":
      return n.arg;
    case "ghost":
      return n.ghost;
    case "prompt":
      return n.prompt;
    case "output":
      return "";
  }
}

// The blink + style-token stylesheet, scoped to `prefix`. Pure (no DOM) so it
// can be tested. Colors stay subtle — the CRT phosphor already tints everything.
export function buildTerminalCss(prefix: string): string {
  const n = termNames(prefix);
  return `
@keyframes ${n.blinkKeyframe} { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.${n.cursor} { animation: ${n.blinkKeyframe} ${BLINK_MS}ms infinite; }
/* The session log wraps (the help table can be wider than the box) — the live
   game body keeps the CRT <pre>'s no-wrap so its grid stays rigid. */
.${n.scrollback} { white-space: pre-wrap; word-break: break-word; }
.${n.prompt} { opacity: 0.8; }
.${n.echo} { opacity: 0.85; }
.${n.error} { color: #ff6b6b; }
.${n.unknown} { color: #ffb86b; }
.${n.arg} { opacity: 0.85; }
.${n.ghost} { opacity: 0.4; }
`;
}

export type InlineTerminalOptions = {
  // The command surface — drives `help`, completion, dispatch (queried live).
  source: CommandSource;
  // Element the command-line keydown listens on — the focusable CRT screen, so
  // typing only reaches THIS sandbox while it's focused.
  keyTarget: HTMLElement;
  // Namespaces the emitted classes / keyframe (e.g. "tts"). Match the CRT
  // screen's `classPrefix`.
  classPrefix: string;
  // The command shown as having "started" the game (e.g. "npm run tts").
  launchCommand: string;
  // The shell prompt glyph; defaults to the fish-shell prompt.
  prompt?: string;
  // Lines printed once on launch (and re-printed by `reset`) — e.g. the command
  // list, so the embed is self-documenting.
  banner?: string;
  // Clear the session log on every command, so the rendered height stays bounded
  // (an always-on terminal in a fixed-size feed embed). See `ShellOptions`.
  clearOnSubmit?: boolean;
};

export type InlineTerminal = {
  // Replace the readout body — the lens writes the state readout here each tick.
  setBody(text: string): void;
  // Re-launch — clear the session log + command line and re-print the banner.
  reset(): void;
  destroy(): void;
};

// Build the always-on terminal furniture inside `surface` (the CRT screen's
// <pre>), driving the shell core for the command line + session log.
export function mountInlineTerminal(
  surface: HTMLElement,
  opts: InlineTerminalOptions,
): InlineTerminal {
  const n = termNames(opts.classPrefix);
  const prompt = opts.prompt ?? DEFAULT_PROMPT;

  const shell = createShell({
    source: opts.source,
    prompt,
    ...(opts.banner !== undefined ? { banner: opts.banner } : {}),
    ...(opts.clearOnSubmit !== undefined ? { clearOnSubmit: opts.clearOnSubmit } : {}),
  });

  const styleHost = surface.parentElement ?? surface;
  const style = document.createElement("style");
  style.textContent = buildTerminalCss(opts.classPrefix);
  styleHost.appendChild(style);

  // Layout inside the <pre> (whitespace-preserving): launch header, live body,
  // session-log scrollback, then the live command line.
  const header = document.createTextNode(`${prompt}${opts.launchCommand}\n`);
  const bodyEl = document.createElement("span");
  bodyEl.className = n.body;
  const bodyBreak = document.createTextNode("\n");
  const scrollbackEl = document.createElement("span");
  scrollbackEl.className = n.scrollback;
  const promptEl = document.createElement("span");
  promptEl.className = n.prompt;
  const beforeEl = document.createElement("span");
  const cursor = document.createElement("span");
  cursor.className = n.cursor;
  cursor.textContent = CURSOR_GLYPH;
  cursor.setAttribute("aria-hidden", "true");
  const afterEl = document.createElement("span");

  surface.textContent = "";
  surface.append(
    header,
    bodyEl,
    bodyBreak,
    scrollbackEl,
    promptEl,
    beforeEl,
    cursor,
    afterEl,
  );

  // ── Paint: project the shell ViewModel into the log + command line ─────────
  function paint(): void {
    const vm = shell.view();
    scrollbackEl.textContent = "";
    for (const linevm of vm.scrollback) {
      for (const s of linevm.spans) {
        const cls = tokenClass(n, s.style);
        if (cls === "") {
          scrollbackEl.appendChild(document.createTextNode(s.text));
        } else {
          const span = document.createElement("span");
          span.className = cls;
          span.textContent = s.text;
          scrollbackEl.appendChild(span);
        }
      }
      scrollbackEl.appendChild(document.createTextNode("\n"));
    }
    promptEl.textContent = vm.edit.prompt;
    beforeEl.textContent = vm.edit.before;
    afterEl.textContent = vm.edit.after + (vm.edit.suggestion ?? "");
  }
  const unsubscribe = shell.subscribe(paint);
  shell.activate(); // print the banner (paints via the subscription)
  paint();

  // ── Input: typing-only, element-scoped, always-on ─────────────────────────
  function eventFor(e: KeyboardEvent): TermEvent | null {
    if (e.key === "Enter") return { kind: "key", key: "enter" };
    if (e.key === "Backspace") return { kind: "key", key: "backspace" };
    if (e.key === "Tab") return { kind: "key", key: "tab" };
    if (e.key.length === 1 && TYPING_KEY.test(e.key)) return { kind: "insert", ch: e.key };
    // Space separates command arguments (`rewind 5`) — but only mid-command. An
    // empty line leaves Space to the lens, where it's the hard-drop key.
    if (e.key === " " && shell.view().edit.before.length > 0) return { kind: "insert", ch: " " };
    return null; // arrows / leading space / etc. → the lens (gameplay)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const ev = eventFor(e);
    if (ev === null) return; // not ours — leave it for the lens
    shell.handle(ev);
    // A key we consumed: stop it here so the lens's own keydown (same element,
    // capture phase, registered after us) doesn't also act on it — otherwise a
    // Space typed into a command would double as a drop.
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  opts.keyTarget.addEventListener("keydown", onKeyDown, true);

  return {
    setBody(text: string): void {
      bodyEl.textContent = text;
    },
    reset(): void {
      shell.reset();
    },
    destroy(): void {
      opts.keyTarget.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      if (style.parentNode === styleHost) styleHost.removeChild(style);
      surface.textContent = "";
    },
  };
}
