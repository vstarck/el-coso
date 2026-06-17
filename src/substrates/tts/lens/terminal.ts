/* tts terminal furniture — the lines around the JSON readout that make the
 * lens read as a shell session:
 *
 *     ⋊> ~ npm run tts        ← the command that "ran" tts (header)
 *     { ...state JSON... }     ← the live readout (body, rewritten each tick)
 *     <command output>         ← responses to commands (e.g. `help`)
 *     theme█                   ← the in-tts command line (typed input + cursor)
 *
 * No prompt glyph on the footer: the player is inside tts, not the shell. The
 * footer is a real command line — printable keys type into a buffer, Enter
 * submits it (reported via `onCommand`; the lens dispatches). `reset` rebuilds
 * fresh furniture (a re-launch).
 *
 * Built inside the CRT screen's text surface, so the blur / glow / wobble all
 * cascade onto it for free. Prompt + launch line are constants below.
 */

const FISH_PROMPT = "⋊> ~ "; // the fish-shell prompt glyph (the player's love)
const LAUNCH_COMMAND = "npm run tts"; // the command shown as having started tts

const CURSOR_GLYPH = "█";
const BLINK_MS = 1000;

// Keys that type into the command line. Gameplay keys (arrows, space) are
// deliberately excluded so they stay with the lens.
const TYPING_KEY = /^[a-zA-Z0-9-]$/;

const STYLE = `
@keyframes tts-term-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.tts-term-cursor { animation: tts-term-blink ${BLINK_MS}ms infinite; }
`;

export type TerminalOptions = {
  // Fired when the player submits a non-empty line (Enter). The terminal has
  // already cleared its input buffer; the lens decides what the command does.
  onCommand: (name: string) => void;
  // Element the command-line keydown listens on — the focusable CRT screen,
  // so typing only reaches THIS sandbox while it's focused.
  keyTarget: HTMLElement;
};

export type Terminal = {
  // Replace the readout body — the lens writes the state JSON here each tick.
  setBody(text: string): void;
  // Write (or clear, with "") the command-output area below the readout.
  print(text: string): void;
  // Rebuild fresh furniture — a re-launch. Clears any output + input.
  reset(): void;
  destroy(): void;
};

function makeCursor(): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = "tts-term-cursor";
  c.textContent = CURSOR_GLYPH;
  c.setAttribute("aria-hidden", "true");
  return c;
}

// Build the terminal furniture inside `surface` (the CRT screen's <pre>).
export function mountTerminal(surface: HTMLElement, opts: TerminalOptions): Terminal {
  const styleHost = surface.parentElement ?? surface;
  const style = document.createElement("style");
  style.textContent = STYLE;
  styleHost.appendChild(style);

  // Reassigned by `build()` — the live nodes the lens writes through.
  let body!: HTMLSpanElement;
  let output!: HTMLSpanElement;
  let input!: HTMLSpanElement;

  let buffer = "";

  // Lay out: launch line, live JSON body, command-output area, then the
  // command line (typed text + blinking cursor).
  function build(): void {
    surface.textContent = "";
    const header = document.createTextNode(`${FISH_PROMPT}${LAUNCH_COMMAND}\n`);
    body = document.createElement("span");
    body.className = "tts-term-body";
    output = document.createElement("span");
    output.className = "tts-term-output";
    const footerBreak = document.createTextNode(`\n`);
    input = document.createElement("span");
    input.className = "tts-term-input";
    surface.append(header, body, output, footerBreak, input, makeCursor());
  }
  build();

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      const name = buffer.trim();
      buffer = "";
      input.textContent = "";
      if (name.length > 0) opts.onCommand(name);
    } else if (e.key === "Backspace") {
      buffer = buffer.slice(0, -1);
      input.textContent = buffer;
    } else if (
      (e.key.length === 1 && TYPING_KEY.test(e.key)) ||
      // Space separates command arguments (`rewind 5`) — but only mid-command.
      // An empty buffer leaves Space to the lens, where it's the hard-drop key.
      (e.key === " " && buffer.length > 0)
    ) {
      buffer += e.key;
      input.textContent = buffer;
    } else {
      return; // not ours — leave it for the lens (arrows / leading space)
    }
    // A key we consumed: stop it here so the lens's own keydown (same element,
    // capture phase, registered after us) doesn't also act on it — otherwise a
    // Space typed into a command would double as a drop.
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  opts.keyTarget.addEventListener("keydown", onKeyDown, true);

  return {
    setBody(text: string): void {
      body.textContent = text;
    },
    print(text: string): void {
      output.textContent = text ? `\n${text}` : "";
    },
    reset(): void {
      buffer = "";
      build();
    },
    destroy(): void {
      opts.keyTarget.removeEventListener("keydown", onKeyDown, true);
      if (style.parentNode === styleHost) styleHost.removeChild(style);
      surface.textContent = "";
    },
  };
}
