/* Terminal-kit CRT screen — a terminal lens's display, as pure CSS+JS (no
 * canvas) CRT treatment: a <pre> text surface inside a wobbling, scanlined,
 * phosphor-glowing "screen". The lens writes text into `text` and drives
 * `setColor` / `setBackground` / `setEnabled`; everything else (wobble
 * keyframes, the scanline overlay, the blur + glow) is generated here from the
 * constants below.
 *
 * The CRT *look* (wobble amount, scanline spacing, glow strength) is a shared
 * kit default — edit the `CRT` constants here and every terminal substrate
 * inherits the change. The master on/off is `setEnabled` (a lens drives it from
 * its active theme's `crt` flag); each sub-effect carries its own `enabled`, so
 * scanlines / blur switch off by a constant edit, independent of the master.
 *
 * Every emitted class name, keyframe, and CSS variable is scoped by the
 * caller's `classPrefix`, so two terminal substrates can mount on one page
 * without their stylesheets colliding (each picks a distinct prefix, e.g.
 * "tts" / "vroom"). With a given prefix the generated CSS is stable.
 */

// Every CRT amount lives here so it's tunable by a constant edit. Whether the
// treatment is on at all is theme-owned (the lens calls `setEnabled`).
const CRT = {
  // 1 — gentle screen wobble + phosphor flicker (the whole screen drifts)
  wobble: {
    enabled: true,
    amp_px: 0.5, // peak translation
    skew_deg: 0.05, // peak horizontal skew
    period_ms: 5200, // one full wobble cycle
    flicker: 0.05, // brightness dip per flicker (0 = no flicker)
    flicker_ms: 110, // flicker cadence
  },

  // 2 — scanlines (a fixed horizontal line grid over the text)
  scanlines: {
    enabled: true,
    spacing_px: 3, // distance between dark lines
    thickness_px: 1, // dark line thickness
    opacity: 0.28, // darkness of each line
  },

  // 3 — phosphor blur + glow (glow tints to the current text color)
  blur: {
    enabled: true,
    radius_px: 0.5, // text blur radius
    glow_px: 7, // glow spread
    glow_opacity: 0.55, // glow strength
  },
} as const;

// Default readout font size (px). A lens can override it at runtime via
// `setFontSize` (e.g. wired to an undeclared `font_size` embed option).
export const CRT_DEFAULT_FONT_PX = 15;

// The prefix-derived names. All CSS the kit emits, and every node it tags,
// goes through here so a substrate's whole terminal stylesheet is namespaced.
function crtNames(prefix: string) {
  return {
    screen: `${prefix}-crt-screen`,
    text: `${prefix}-crt-text`,
    scanlines: `${prefix}-crt-scanlines`,
    focused: `${prefix}-focused`,
    wobbleKeyframe: `${prefix}-crt-wobble`,
    flickerKeyframe: `${prefix}-crt-flicker`,
    glowVar: `--${prefix}-glow`,
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Build the CRT stylesheet from the constants above, scoped to `prefix`. A
// sub-effect whose `enabled` is false emits no rule, so it stays off even when
// the master switch is on. All effects live under the `.<prefix>-crt-screen.on`
// class, which `setEnabled` toggles. Pure (no DOM) so it can be tested.
export function buildCrtCss(prefix: string, width: number): string {
  const n = crtNames(prefix);
  const w = CRT.wobble;
  const s = CRT.scanlines;
  const b = CRT.blur;
  const parts: string[] = [];

  if (w.enabled) {
    parts.push(`@keyframes ${n.wobbleKeyframe} {
  0%   { transform: translate(0, 0) skewX(0deg); }
  20%  { transform: translate(${w.amp_px}px, ${(-w.amp_px * 0.5).toFixed(3)}px) skewX(${w.skew_deg}deg); }
  40%  { transform: translate(${(-w.amp_px * 0.6).toFixed(3)}px, ${(w.amp_px * 0.3).toFixed(3)}px) skewX(${(-w.skew_deg).toFixed(3)}deg); }
  60%  { transform: translate(${(w.amp_px * 0.4).toFixed(3)}px, ${(w.amp_px * 0.6).toFixed(3)}px) skewX(${(w.skew_deg * 0.6).toFixed(3)}deg); }
  80%  { transform: translate(${(-w.amp_px * 0.3).toFixed(3)}px, ${(-w.amp_px * 0.4).toFixed(3)}px) skewX(${(-w.skew_deg * 0.5).toFixed(3)}deg); }
  100% { transform: translate(0, 0) skewX(0deg); }
}`);
    if (w.flicker > 0) {
      parts.push(`@keyframes ${n.flickerKeyframe} {
  0%, 100% { opacity: 1; }
  50% { opacity: ${(1 - w.flicker).toFixed(3)}; }
}`);
    }
  }

  parts.push(`.${n.screen} { position: relative; width: ${width}px; }`);

  const anims: string[] = [];
  if (w.enabled)
    anims.push(`${n.wobbleKeyframe} ${w.period_ms}ms ease-in-out infinite`);
  if (w.enabled && w.flicker > 0) {
    anims.push(`${n.flickerKeyframe} ${w.flicker_ms}ms steps(2, end) infinite`);
  }
  if (anims.length > 0) {
    parts.push(
      `.${n.screen}.on { animation: ${anims.join(", ")}; will-change: transform, opacity; }`,
    );
  }

  if (b.enabled) {
    parts.push(
      `.${n.screen}.on .${n.text} { filter: blur(${b.radius_px}px); text-shadow: var(${n.glowVar}); }`,
    );
  }

  parts.push(
    `.${n.scanlines} { position: absolute; inset: 0; pointer-events: none; display: none; }`,
  );
  if (s.enabled) {
    const line = `rgba(0, 0, 0, ${s.opacity})`;
    parts.push(`.${n.screen}.on .${n.scanlines} {
  display: block;
  background: repeating-linear-gradient(
    to bottom,
    ${line} 0,
    ${line} ${s.thickness_px}px,
    transparent ${s.thickness_px}px,
    transparent ${s.spacing_px}px
  );
}`);
  }

  return parts.join("\n");
}

export type CrtScreen = {
  // The focusable screen wrapper. Keyboard listeners attach HERE (not on
  // window), so each sandbox only responds while it's the focused element —
  // multiple embeds on one page stay isolated.
  root: HTMLElement;
  // The text surface the lens writes its readout into.
  text: HTMLPreElement;
  // Set the readout color; the phosphor glow re-tints to match.
  setColor(hex: string): void;
  // Set the terminal background (any CSS color; "transparent" inherits the
  // host page). Theme-owned.
  setBackground(color: string): void;
  // Set the readout font size (px).
  setFontSize(px: number): void;
  // Master CRT switch — the lens drives it from the active theme's `crt` flag.
  setEnabled(on: boolean): void;
  // Tear down the screen DOM + injected stylesheet.
  destroy(): void;
};

export type CrtOptions = {
  // The render envelope width in px (the lens's BOUNDED footprint).
  width: number;
  // Namespaces every emitted class / keyframe / CSS var (e.g. "tts"). Distinct
  // per substrate so two terminals can share a page.
  classPrefix: string;
  // Accessible label for the text readout (e.g. "tetris state").
  ariaLabel: string;
  // Initial readout font size; defaults to CRT_DEFAULT_FONT_PX.
  fontPx?: number;
};

// Build the screen scaffolding inside `container`: a stylesheet, the screen
// wrapper, the <pre> text surface, and the scanline overlay.
export function mountCrtScreen(
  container: HTMLElement,
  opts: CrtOptions,
): CrtScreen {
  const n = crtNames(opts.classPrefix);
  const fontPx = opts.fontPx ?? CRT_DEFAULT_FONT_PX;

  const style = document.createElement("style");
  style.textContent = buildCrtCss(opts.classPrefix, opts.width);

  const screen = document.createElement("div");
  screen.className = n.screen;
  // Focusable, so keyboard listeners can scope to this sandbox (only respond
  // while focused). Click anywhere on the screen to focus it; no focus ring so
  // the CRT look stays clean.
  screen.tabIndex = 0;
  screen.style.outline = "none";
  const focusScreen = () => screen.focus();
  screen.addEventListener("pointerdown", focusScreen);
  // Reflect focus as a class on the wrapper so the embedding page can theme
  // the active sandbox (e.g. `.<prefix>-crt-screen.<prefix>-focused { ... }`).
  const onFocus = () => screen.classList.add(n.focused);
  const onBlur = () => screen.classList.remove(n.focused);
  screen.addEventListener("focus", onFocus);
  screen.addEventListener("blur", onBlur);

  const text = document.createElement("pre");
  text.className = n.text;
  text.style.cssText = [
    "width:100%",
    "margin:0",
    "padding:16px",
    "box-sizing:border-box",
    "background:transparent",
    "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    `font-size:${fontPx}px`,
    "line-height:1.35",
    "white-space:pre",
    "user-select:text",
  ].join(";");
  text.setAttribute("aria-label", opts.ariaLabel);

  const scanlines = document.createElement("div");
  scanlines.className = n.scanlines;
  scanlines.setAttribute("aria-hidden", "true");

  screen.append(text, scanlines);
  container.append(style, screen);

  return {
    root: screen,
    text,
    setColor(hex: string): void {
      text.style.color = hex;
      screen.style.setProperty(
        n.glowVar,
        `0 0 ${CRT.blur.glow_px}px ${hexToRgba(hex, CRT.blur.glow_opacity)}`,
      );
    },
    setBackground(color: string): void {
      screen.style.background = color;
    },
    setFontSize(px: number): void {
      text.style.fontSize = `${px}px`;
    },
    setEnabled(on: boolean): void {
      screen.classList.toggle("on", on);
    },
    destroy(): void {
      screen.removeEventListener("pointerdown", focusScreen);
      screen.removeEventListener("focus", onFocus);
      screen.removeEventListener("blur", onBlur);
      if (style.parentNode === container) container.removeChild(style);
      if (screen.parentNode === container) container.removeChild(screen);
    },
  };
}
