/* Terminal-lens kit — shared furniture for substrates whose lens is a terminal
 * session: a pure-CSS CRT screen (`crt`), shell furniture + command line
 * (`terminal`), a guake-style drop-down command console (`console`), and a
 * default theme palette (`theme`). Each mounting substrate passes a distinct
 * `classPrefix` so several terminals can share one page without their
 * stylesheets colliding. tts is the reference terminal consumer; the
 * `@/lenses/withConsole` decorator is the reference console consumer.
 */

export {
  mountCrtScreen,
  buildCrtCss,
  CRT_DEFAULT_FONT_PX,
  type CrtScreen,
  type CrtOptions,
} from "./crt";

export {
  mountInlineTerminal,
  buildTerminalCss,
  type InlineTerminal,
  type InlineTerminalOptions,
} from "./terminal";

export {
  mountConsole,
  buildConsoleCss,
  type ConsoleWidget,
  type ConsoleOptions,
} from "./console";

// The render-free shell core (spec/26) — the console's logic, DOM-free. A
// substrate builds a `CommandSource`; the DOM backend (or a future canvas one)
// drives the core.
export {
  createShell,
  buildHelpText,
  coerceArgs,
  DEFAULT_PROMPT,
  type Shell,
  type ShellOptions,
  type CommandSource,
  type CommandDescriptor,
  type ConsoleArgSpec,
  type TermEvent,
  type TermKey,
  type ViewModel,
  type ViewLine,
  type EditLine,
  type Span,
  type StyleToken,
} from "./shell";

export { THEMES, DEFAULT_THEME, type Theme } from "./theme";
