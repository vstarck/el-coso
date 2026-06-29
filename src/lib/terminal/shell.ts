/* Terminal shell — the render-engine-free core of the guake console (spec/26).
 * It owns ALL the shell state: the scrollback, the edit line (with cursor), the
 * command history, completion, and dispatch. It has ZERO references to the DOM,
 * `window`, or any canvas — it is driven entirely by abstract `TermEvent`s in
 * and emits a pure-data `ViewModel` out. A backend (the DOM one in `console.ts`,
 * a future canvas/WebGL one) captures native input, translates it to
 * `TermEvent`s, and paints the `ViewModel`. The same shape spec/24 uses for
 * ASCII lenses: state → IR → backend.
 *
 * The core knows nothing about lenses, hosts, or tunables. It talks to "the set
 * of commands" only through the abstract `CommandSource`, queried LIVE (never
 * cached) so a substrate whose available verbs change with state is reflected
 * the next keystroke. The one universal affordance the core owns is `help`
 * (every terminal wants it); a source that lists its own `help` overrides it.
 * `Ctrl-L` clears the screen as a keybinding — there is deliberately no `clear`
 * command, so substrates are free to mean whatever they want by that name.
 */

export const DEFAULT_PROMPT = "⋊> ~ "; // the fish-shell prompt glyph

// ── Command surface (abstract) ───────────────────────────────────────────────

export type ConsoleArgSpec = {
  name: string;
  type: "number" | "string" | "bool";
};

// The subset of a command the shell needs: its name (typed at the prompt), an
// optional one-line label for `help`, and its positional arg specs (for
// type-coercion + the help hint). Shaped to accept a lens's `EmbedCommandSpec`.
export type CommandDescriptor = {
  name: string;
  label?: string;
  args?: ReadonlyArray<ConsoleArgSpec>;
};

// What the shell needs from "a set of commands", abstractly. Queried live: a
// static array is a source whose `list()` is constant; a dynamic substrate
// returns a state-dependent list. The shell never caches it.
export type CommandSource = {
  // The commands available right now — drives completion, help, dispatch check.
  list(): ReadonlyArray<CommandDescriptor>;
  // Run a parsed, type-coerced command. Return text to print under the echo;
  // throw to print an `error: …` line. Owns built-in-vs-substrate routing.
  dispatch(name: string, args: unknown[]): string | void;
};

// ── Input (abstract) ─────────────────────────────────────────────────────────

// The backend translates its native events (DOM keydown, a canvas key map) into
// these BEFORE the core sees anything, so the core has no DOM/window dependency.
export type TermEvent =
  | { kind: "insert"; ch: string }
  | { kind: "key"; key: TermKey };

export type TermKey =
  | "enter"
  | "backspace"
  | "tab"
  | "history-prev" // ↑
  | "history-next" // ↓
  | "left"
  | "right"
  | "home"
  | "end"
  | "clear-screen"; // Ctrl-L — clears scrollback (a keybinding, NOT a command)

// ── View model (the IR) ──────────────────────────────────────────────────────

// Semantic style TOKENS, never colors — the theme/backend resolves them (the
// terminal analogue of spec/24's cell purity). `known-cmd`/`arg`/`ghost` are
// painted by the v1.1 syntax-highlight + autosuggestion features; v1 emits only
// the first five.
export type StyleToken =
  | "output"
  | "echo"
  | "error"
  | "prompt"
  | "unknown-cmd"
  | "known-cmd"
  | "arg"
  | "ghost";

export type Span = { text: string; style: StyleToken };
export type ViewLine = { spans: Span[] };

export type EditLine = {
  prompt: string;
  before: string; // text left of the cursor
  after: string; // text right of the cursor (cursor sits between)
  suggestion?: string; // fish-style ghost text, painted dim after `after`
};

export type ViewModel = {
  scrollback: ReadonlyArray<ViewLine>; // committed output, oldest → newest
  edit: EditLine;
  completion?: ReadonlyArray<CommandDescriptor>; // active completion list, if any
};

export type ShellOptions = {
  source: CommandSource;
  prompt?: string; // default the fish prompt
  banner?: string; // printed once on first activate()
  // Clear the transient log at the start of every submit, so only the current
  // command's transcript (echo + result) is shown below the pinned banner.
  // Bounds the rendered height — useful for an always-on terminal in a
  // fixed-size feed embed. The `banner` is a persistent header: it survives the
  // clear (and `clear-screen`), so an intro / command list stays visible.
  clearOnSubmit?: boolean;
};

export type Shell = {
  handle(e: TermEvent): void; // mutate state from one input event
  view(): ViewModel; // current render-agnostic view
  subscribe(cb: () => void): () => void; // fires after any state change
  print(text: string, style?: StyleToken): void; // push a scrollback line
  activate(): void; // first-open hook (prints the banner once)
  reset(): void; // re-launch — clear scrollback + edit line, reprint the banner
};

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

// The universal `help` command the core provides when the source doesn't.
const HELP: CommandDescriptor = { name: "help", label: "list commands" };

// Format the `help` list, aligning labels to the widest command signature so a
// new command needs no manual spacing.
export function buildHelpText(commands: ReadonlyArray<CommandDescriptor>): string {
  const withHelp = commands.some((c) => c.name === "help")
    ? commands
    : [...commands, HELP];
  const sig = (c: CommandDescriptor) =>
    [c.name, ...(c.args ?? []).map((a) => `<${a.name}>`)].join(" ");
  const width = Math.max(0, ...withHelp.map((c) => sig(c).length));
  const lines = withHelp.map(
    (c) => `  ${sig(c).padEnd(width)}   ${c.label ?? ""}`.trimEnd(),
  );
  return ["commands:", ...lines].join("\n");
}

// Coerce raw whitespace tokens to the command's declared arg types. Tokens past
// the declared specs pass through as strings. Throws on a malformed value so the
// caller can surface it (never a silent bad coercion).
export function coerceArgs(
  spec: CommandDescriptor,
  tokens: string[],
): unknown[] {
  return tokens.map((tok, i) => {
    const type = spec.args?.[i]?.type;
    const argName = spec.args?.[i]?.name ?? `arg${i + 1}`;
    if (type === "number") {
      const n = Number(tok);
      if (!Number.isFinite(n)) {
        throw new Error(`${spec.name}: expected a number for ${argName}, got "${tok}"`);
      }
      return n;
    }
    if (type === "bool") {
      if (/^(1|true|on|yes|y)$/i.test(tok)) return true;
      if (/^(0|false|off|no|n)$/i.test(tok)) return false;
      throw new Error(`${spec.name}: expected true/false for ${argName}, got "${tok}"`);
    }
    return tok; // string, or an extra positional
  });
}

// ── The core ─────────────────────────────────────────────────────────────────

export function createShell(opts: ShellOptions): Shell {
  const source = opts.source;
  const prompt = opts.prompt ?? DEFAULT_PROMPT;

  // The pinned banner (intro / command list) — survives `clearOnSubmit` and
  // `clear-screen`, so it stays a persistent header above the transient log.
  let header: ViewLine[] = [];
  let scrollback: ViewLine[] = []; // transient command transcripts
  let before = ""; // text left of the cursor
  let after = ""; // text right of the cursor — always "" in v1 (cursor at end)
  const history: string[] = [];
  let historyIdx = -1; // -1 = editing a fresh line
  let primed = false; // banner shown on first activate
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const cb of listeners) cb();
  }

  // Split a logical string into ViewLines (one per newline).
  function textToLines(text: string, style: StyleToken = "output"): ViewLine[] {
    return text.split("\n").map((part) => ({ spans: [{ text: part, style }] }));
  }

  // Push one logical line into the transient log.
  function pushLine(text: string, style: StyleToken = "output"): void {
    scrollback.push(...textToLines(text, style));
  }

  // The commands the core treats as available: the live source list, plus the
  // universal `help` unless the source defines its own.
  function currentCommands(): CommandDescriptor[] {
    const list = source.list();
    return list.some((c) => c.name === "help") ? [...list] : [...list, HELP];
  }

  function complete(): void {
    const names = currentCommands().map((c) => c.name);
    const matches = names.filter((n) => n.startsWith(before));
    if (matches.length === 1) {
      before = matches[0]! + " ";
    } else if (matches.length > 1) {
      pushLine(matches.join("  "));
    }
    emit();
  }

  function submit(): void {
    const raw = (before + after).trim();
    before = "";
    after = "";
    historyIdx = -1;
    // Constant-height mode: wipe the transient log (the pinned banner stays) so
    // only this command's transcript shows below the header.
    if (opts.clearOnSubmit) scrollback = [];

    const [name, ...tokens] = raw.split(/\s+/);
    const sourceHasHelp = source.list().some((c) => c.name === "help");

    // When the banner is pinned as a header (clearOnSubmit), it already IS the
    // help display — so typing `help` returns to that intro (the transient was
    // cleared above) instead of printing a duplicate list below the header.
    if (
      raw !== "" &&
      name === "help" &&
      !sourceHasHelp &&
      opts.clearOnSubmit &&
      header.length > 0
    ) {
      history.push(raw);
      emit();
      return;
    }

    pushLine(`${prompt}${raw}`, "echo");
    if (raw === "") {
      emit();
      return;
    }
    history.push(raw);

    if (name === "help" && !sourceHasHelp) {
      pushLine(buildHelpText(source.list()));
      emit();
      return;
    }
    const spec = currentCommands().find((c) => c.name === name);
    if (!spec) {
      pushLine(`unknown command: ${name} — type \`help\``, "unknown-cmd");
      emit();
      return;
    }
    try {
      const result = source.dispatch(name!, coerceArgs(spec, tokens));
      if (typeof result === "string") pushLine(result);
    } catch (err) {
      pushLine(`error: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    emit();
  }

  function handle(e: TermEvent): void {
    if (e.kind === "insert") {
      before += e.ch;
      emit();
      return;
    }
    switch (e.key) {
      case "enter":
        submit();
        break;
      case "backspace":
        before = before.slice(0, -1);
        emit();
        break;
      case "tab":
        complete();
        break;
      case "clear-screen":
        scrollback = [];
        emit();
        break;
      case "history-prev":
      case "history-next":
        if (history.length > 0) {
          if (historyIdx === -1) historyIdx = history.length;
          historyIdx += e.key === "history-prev" ? -1 : 1;
          historyIdx = Math.max(0, Math.min(history.length, historyIdx));
          before = history[historyIdx] ?? "";
          after = "";
          emit();
        }
        break;
      // Cursor motion: v1 keeps the cursor at the end (before holds the whole
      // line, after is empty). v1.1 moves the before/after split here.
      case "left":
      case "right":
      case "home":
      case "end":
        break;
    }
  }

  function view(): ViewModel {
    return {
      scrollback: header.length ? [...header, ...scrollback] : scrollback,
      edit: { prompt, before, after },
    };
  }

  function activate(): void {
    if (primed) return;
    primed = true;
    if (opts.banner) {
      header = textToLines(opts.banner); // pin the banner as a persistent header
      emit();
    }
  }

  function reset(): void {
    scrollback = [];
    before = "";
    after = "";
    historyIdx = -1;
    primed = true; // a reset IS a (re)launch — re-pin the banner now
    header = opts.banner ? textToLines(opts.banner) : [];
    emit();
  }

  return {
    handle,
    view,
    print: (text, style) => {
      if (text === "") return;
      pushLine(text, style);
      emit();
    },
    activate,
    reset,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
