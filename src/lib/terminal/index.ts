/* Terminal-lens kit — shared furniture for substrates whose lens is a terminal
 * session: a pure-CSS CRT screen (`crt`), shell furniture + command line
 * (`terminal`), and a default theme palette (`theme`). Each mounting substrate
 * passes a distinct `classPrefix` so several terminals can share one page
 * without their stylesheets colliding. tts is the reference consumer.
 */

export {
  mountCrtScreen,
  buildCrtCss,
  CRT_DEFAULT_FONT_PX,
  type CrtScreen,
  type CrtOptions,
} from "./crt";

export {
  mountTerminal,
  buildTerminalCss,
  type Terminal,
  type TerminalOptions,
} from "./terminal";

export { THEMES, DEFAULT_THEME, type Theme } from "./theme";
