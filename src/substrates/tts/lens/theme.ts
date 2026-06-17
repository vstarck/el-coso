/* tts themes — the single entity that owns the lens's whole look: the readout
 * text color, the terminal background, and whether the CRT treatment (wobble /
 * scanlines / phosphor glow) is on. Pieces are still told apart by glyph, not
 * color. Selected in chrome (the `theme` enum), via the export (`--set
 * theme=modern`), or with the `theme NAME` command.
 */

export type Theme = {
  text: string; // readout text color (hex; the phosphor glow re-tints to it)
  background: string; // terminal bg (any CSS color; "transparent" = host page)
  crt: boolean; // CRT treatment on/off
};

export const THEMES: Record<string, Theme> = {
  // The original phosphor terminal — green text on the host's dark backdrop.
  default: { text: "#33ff66", background: "transparent", crt: true },
  // DOS / WordPerfect era — white characters on a deep blue screen, CRT on.
  "boomer-blue": { text: "#ffffff", background: "#0d1b8a", crt: true },
  // A crisp, easy-on-the-eye modern editor look — soft grey on charcoal, no CRT.
  modern: { text: "#d4d4d4", background: "#1e1e1e", crt: false },
};

export const DEFAULT_THEME = "default";
