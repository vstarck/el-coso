/* Quake / guake-style drop-down console — the DOM backend for the render-free
 * shell core (`shell.ts`, spec/26). Pressing the toggle key (default backtick,
 * the key left of `1`) slides a translucent panel down from the top of the lens
 * with a scrollback log and a fish-style command line; pressing it again (or
 * Escape) retracts it. The substrate keeps running underneath.
 *
 * This file is the *render engine*: it builds the panel DOM, captures native
 * keydown and translates it into the core's abstract `TermEvent`s, and repaints
 * the core's `ViewModel` (scrollback spans + the edit line) on every change. All
 * the shell logic — history, completion, dispatch — lives in the core; a future
 * canvas/WebGL backend would reuse the same core and only swap input + paint.
 *
 * Host-agnostic (pure DOM, no React, no store) so it works identically in the
 * app, in embeds, and in bare.html. The key listener is window-level CAPTURE
 * phase: it fires before (and, on a consumed key, preventDefault()s) the
 * chrome's bubble-phase shortcuts, and an embed iframe gets its own window for
 * free. Class names are scoped by `classPrefix` so several consoles can coexist
 * on one page.
 *
 * Used by the `@/lenses/withConsole` decorator, but usable directly: hand it a
 * `CommandSource` and it is a self-contained REPL panel.
 */

import {
  createShell,
  DEFAULT_PROMPT,
  type CommandSource,
  type StyleToken,
  type TermEvent,
  type ViewLine,
} from "./shell";
import { THEMES } from "./theme";

// Re-export the core's command/arg vocabulary + pure helpers so existing
// consumers (and `withConsole`) keep one import site for the console kit.
export {
  buildHelpText,
  coerceArgs,
  type CommandDescriptor,
  type CommandSource,
  type ConsoleArgSpec,
} from "./shell";

// The guake toggle is a PHYSICAL key ("left of 1"), not a character — so we
// match it by `KeyboardEvent.code` (layout-independent) rather than `.key` (the
// produced character, which is `~`/`|`/`§`/… across layouts). `Backquote` is
// that physical key on every QWERTY-family board. We also accept the literal
// backtick *character* as a friendly secondary so a remap that still emits
// `` ` `` keeps working.
const DEFAULT_TOGGLE_CODE = "Backquote";
const DEFAULT_TOGGLE_KEY = "`";
// Once open, any printable ASCII types into the command line.
const PRINTABLE = /^[\x20-\x7e]$/;

export type ConsoleOptions = {
  // Namespaces the emitted classes / keyframe (e.g. "conway-console").
  classPrefix: string;
  // Where the panel mounts (absolute, pinned to the top). Usually the lens
  // container. The console makes it a positioning context if it isn't one.
  mountTarget: HTMLElement;
  // The command surface — drives `help`, completion, dispatch (queried live).
  source: CommandSource;
  // Physical key (`KeyboardEvent.code`) that toggles the panel — layout-
  // independent. Defaults to "Backquote" (the key left of `1`).
  toggleCode?: string;
  // Character (`KeyboardEvent.key`) that ALSO toggles the panel — a secondary
  // match for remaps. Defaults to backtick.
  toggleKey?: string;
  // Shell prompt glyph. Defaults to the fish prompt.
  prompt?: string;
  // Lines printed the first time the console opens (e.g. a hint + `help`).
  banner?: string;
  // Fixed panel height in px. Overrides the kit default (`height: 45%`, capped at
  // 360px) when a substrate wants a taller drop-down (e.g. tts shows a banner).
  panelHeightPx?: number;
  // Fired whenever the panel opens or closes (toggle key, Esc, or a programmatic
  // open/close). Lets a decorator expose the open/closed state — e.g. `withConsole`
  // surfaces it as a `console_open` tunable a host toolbar can read + drive.
  onToggle?: (open: boolean) => void;
};

export type ConsoleWidget = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  print(text: string): void;
  destroy(): void;
};

function classNames(prefix: string) {
  return {
    panel: `${prefix}-con-panel`,
    open: `${prefix}-con-open`,
    log: `${prefix}-con-log`,
    line: `${prefix}-con-line`,
    prompt: `${prefix}-con-prompt`,
    before: `${prefix}-con-before`,
    after: `${prefix}-con-after`,
    suggestion: `${prefix}-con-suggestion`,
    cursor: `${prefix}-con-cursor`,
    blink: `${prefix}-con-blink`,
    // Style-token classes (shell.ts StyleToken). `output` is the bare default
    // (no class); the rest get a span.
    echo: `${prefix}-con-echo`,
    error: `${prefix}-con-error`,
    unknown: `${prefix}-con-unknown`,
    known: `${prefix}-con-known`,
    arg: `${prefix}-con-arg`,
    ghost: `${prefix}-con-ghost`,
  };
}

// Map a style token to its scoped class (or "" for the bare-default `output`).
function tokenClass(
  c: ReturnType<typeof classNames>,
  style: StyleToken,
): string {
  switch (style) {
    case "echo":
      return c.echo;
    case "error":
      return c.error;
    case "unknown-cmd":
      return c.unknown;
    case "prompt":
      return c.prompt;
    case "known-cmd":
      return c.known;
    case "arg":
      return c.arg;
    case "ghost":
      return c.ghost;
    case "output":
      return "";
  }
}

// Scoped stylesheet — the slide transition, the phosphor look, the blink, and
// the style-token colors. Pure (no DOM) so it can be unit-tested.
export function buildConsoleCss(prefix: string): string {
  const c = classNames(prefix);
  const palette = THEMES.default!;
  return `
.${c.panel} {
  position: absolute; top: 0; left: 0; right: 0; z-index: 60;
  height: 45%; max-height: 360px;
  display: flex; flex-direction: column;
  box-sizing: border-box; padding: 10px 14px;
  font-family: "Geist Mono", ui-monospace, monospace; font-size: 13px; line-height: 1.5;
  color: ${palette.text};
  background: rgba(6, 10, 8, 0.92);
  border-bottom: 1px solid ${palette.text}55;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  transform: translateY(-100%);
  /* Closed: fully hidden, so the bottom border + shadow don't bleed a line at
     the container's top edge. Visibility flips to hidden only AFTER the slide-up
     finishes (delay = transition duration), so the close animation still shows. */
  visibility: hidden;
  transition: transform 140ms ease-out, visibility 0s linear 140ms;
  text-shadow: 0 0 6px ${palette.text}66;
}
.${c.panel}.${c.open} {
  transform: translateY(0);
  visibility: visible;
  transition: transform 140ms ease-out, visibility 0s linear 0s;
}
.${c.log} { flex: 1; overflow-y: auto; white-space: pre-wrap; word-break: break-word; opacity: 0.92; }
.${c.line} { display: flex; align-items: baseline; padding-top: 6px; white-space: pre-wrap; word-break: break-word; }
.${c.prompt} { opacity: 0.8; white-space: pre; }
.${c.before}, .${c.after} { white-space: pre-wrap; word-break: break-word; }
.${c.cursor} { display: inline-block; width: 0.55em; }
.${c.blink} { animation: ${c.blink} 1000ms steps(1, end) infinite; }
@keyframes ${c.blink} { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.${c.echo} { opacity: 0.85; }
.${c.error} { color: #ff6b6b; }
.${c.unknown} { color: #ffb86b; }
.${c.known} { color: ${palette.text}; }
.${c.arg} { opacity: 0.85; }
.${c.ghost} { opacity: 0.4; }
.${c.suggestion} { opacity: 0.4; white-space: pre; }
`;
}

export function mountConsole(opts: ConsoleOptions): ConsoleWidget {
  const c = classNames(opts.classPrefix);
  const prompt = opts.prompt ?? DEFAULT_PROMPT;
  const toggleKey = opts.toggleKey ?? DEFAULT_TOGGLE_KEY;

  const toggleCode = opts.toggleCode ?? DEFAULT_TOGGLE_CODE;

  // The guake toggle, matched by physical position first (works on every
  // layout), then by the literal character (a remap that still emits backtick).
  function isToggle(e: KeyboardEvent): boolean {
    return e.code === toggleCode || e.key === toggleKey;
  }

  const shell = createShell({
    source: opts.source,
    prompt,
    ...(opts.banner !== undefined ? { banner: opts.banner } : {}),
  });

  // Make the mount target a positioning context for the absolute panel; restore
  // on destroy if we changed it.
  const target = opts.mountTarget;
  const hadStaticPosition =
    typeof getComputedStyle === "function" &&
    getComputedStyle(target).position === "static";
  if (hadStaticPosition) target.style.position = "relative";

  const style = document.createElement("style");
  style.textContent = buildConsoleCss(opts.classPrefix);
  target.appendChild(style);

  const panel = document.createElement("div");
  panel.className = c.panel;
  panel.setAttribute("role", "log");
  // A substrate-requested fixed height beats the stylesheet's `height: 45%;
  // max-height: 360px` (inline styles win), so the drop-down is exactly as tall
  // as asked regardless of how tall the container readout is.
  if (opts.panelHeightPx !== undefined) {
    panel.style.height = `${opts.panelHeightPx}px`;
    panel.style.maxHeight = "none";
  }
  const log = document.createElement("div");
  log.className = c.log;
  const line = document.createElement("div");
  line.className = c.line;
  const promptEl = document.createElement("span");
  promptEl.className = c.prompt;
  const beforeEl = document.createElement("span");
  beforeEl.className = c.before;
  const cursor = document.createElement("span");
  cursor.className = `${c.cursor} ${c.blink}`;
  cursor.textContent = "█";
  cursor.setAttribute("aria-hidden", "true");
  const afterEl = document.createElement("span");
  afterEl.className = c.after;
  const suggestionEl = document.createElement("span");
  suggestionEl.className = c.suggestion;
  line.append(promptEl, beforeEl, cursor, afterEl, suggestionEl);
  panel.append(log, line);
  target.appendChild(panel);

  // ── Paint: project the core's ViewModel into the panel DOM ─────────────────
  // Scrollback grows append-only between paints; we render only the new tail
  // and rebuild wholesale when it shrank (a `clear-screen`).
  let renderedLines = 0;

  function renderLine(vl: ViewLine): HTMLDivElement {
    const div = document.createElement("div");
    for (const s of vl.spans) {
      const cls = tokenClass(c, s.style);
      if (cls === "") {
        div.appendChild(document.createTextNode(s.text));
      } else {
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = s.text;
        div.appendChild(span);
      }
    }
    return div;
  }

  function paint(): void {
    const vm = shell.view();
    if (vm.scrollback.length < renderedLines) {
      log.textContent = "";
      renderedLines = 0;
    }
    for (let i = renderedLines; i < vm.scrollback.length; i++) {
      log.appendChild(renderLine(vm.scrollback[i]!));
    }
    if (vm.scrollback.length > renderedLines) {
      log.scrollTop = log.scrollHeight;
      renderedLines = vm.scrollback.length;
    }
    promptEl.textContent = vm.edit.prompt;
    beforeEl.textContent = vm.edit.before;
    afterEl.textContent = vm.edit.after;
    suggestionEl.textContent = vm.edit.suggestion ?? "";
  }

  const unsubscribe = shell.subscribe(paint);
  paint();

  let open = false;
  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    panel.classList.toggle(c.open, open);
    if (open) shell.activate();
    opts.onToggle?.(open);
  }

  // Translate a native keydown (while open) into a TermEvent. Returns null for
  // keys the console doesn't own — the panel still swallows them only if it's a
  // close/toggle. Modifier combos (other than Ctrl-L) are left for the host.
  function eventFor(e: KeyboardEvent): TermEvent | null {
    if (e.key === "Enter") return { kind: "key", key: "enter" };
    if (e.key === "Backspace") return { kind: "key", key: "backspace" };
    if (e.key === "Tab") return { kind: "key", key: "tab" };
    if (e.key === "ArrowUp") return { kind: "key", key: "history-prev" };
    if (e.key === "ArrowDown") return { kind: "key", key: "history-next" };
    if (e.key === "ArrowLeft") return { kind: "key", key: "left" };
    if (e.key === "ArrowRight") return { kind: "key", key: "right" };
    if (e.key === "Home") return { kind: "key", key: "home" };
    if (e.key === "End") return { kind: "key", key: "end" };
    if (e.key.length === 1 && PRINTABLE.test(e.key))
      return { kind: "insert", ch: e.key };
    return null;
  }

  // window CAPTURE so we run before (and, via preventDefault, suppress) the
  // chrome's bubble-phase shortcuts and the lens's own key handling while open.
  function onKeyDown(e: KeyboardEvent): void {
    if (!target.isConnected) return;

    if (!open) {
      if (isToggle(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setOpen(true);
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    // Open: the console owns the keyboard. Ctrl-L clears the screen (the only
    // modifier combo we intercept; it's a keybinding, not a command).
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
      shell.handle({ kind: "key", key: "clear-screen" });
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave other combos to the host

    if (isToggle(e) || e.key === "Escape") {
      setOpen(false);
    } else {
      const ev = eventFor(e);
      if (ev === null) return; // not ours — and not a toggle, so don't swallow
      shell.handle(ev);
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  window.addEventListener("keydown", onKeyDown, true);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    print: (text: string) => shell.print(text),
    destroy: () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      if (panel.parentNode === target) target.removeChild(panel);
      if (style.parentNode === target) target.removeChild(style);
      if (hadStaticPosition) target.style.position = "";
    },
  };
}
