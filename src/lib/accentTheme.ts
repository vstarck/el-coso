/* Lens accent → CSS-var derivation. The lens declares one hex via
 * `LensTheme.accent`; this module derives the six `--accent-*` CSS vars
 * for the current theme (dark/light) and writes them onto
 * `document.documentElement` as inline style. Theme.ts owns the
 * `data-theme` attribute that controls neutrals (bg, text, borders);
 * this module is orthogonal — it only touches the accent family, so
 * theme + lens accent compose cleanly.
 *
 * Why derivation and not "lens declares 6 vars × 2 themes": the lens
 * author cares about identity, not chrome plumbing. One color suffices
 * for most lenses; if a lens needs theme-specific shades later, the
 * type can grow without breaking call sites.
 */

import { getLensTheme } from "@/lenses/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyLens = { theme?: { accent: string } | undefined };
/* eslint-enable @typescript-eslint/no-explicit-any */

type Hsl = { h: number; s: number; l: number };
type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  let s = hex.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const v = parseInt(s, 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToCss({ h, s, l }: Hsl): string {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

// sRGB relative luminance (WCAG). Used to decide whether the accent's
// `text` foreground should be light or dark — the play button's icon
// has to remain readable on top of the accent fill.
function relativeLuminance(rgb: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

// rgba(R, G, B, a) literal — used for the tint family that the chrome
// composites over surfaces.
function rgba(rgb: Rgb, a: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

// Derive the 6 accent vars. The light-theme shade darkens the accent's
// lightness by ~20 points (matching how the amber default goes
// #fbbf24 → #b45309). Saturation stays; small lightness drops do not
// shift hue perceptibly for the colors we use.
type DerivedAccent = {
  "--accent": string;
  "--accent-text": string;
  "--accent-tint": string;
  "--accent-tint-2": string;
  "--accent-edge": string;
  "--accent-row-bg": string;
};

const LIGHT_THEME_L_DELTA = -20;

function deriveAccent(hex: string, theme: "dark" | "light"): DerivedAccent {
  const baseRgb = hexToRgb(hex);
  const baseHsl = rgbToHsl(baseRgb);

  // Pick the shade per theme. Dark uses the lens's hex as-is; light
  // darkens it for readable contrast on a light bg. The rgba tints
  // *always* sample from the dark-theme base color so the tint family
  // stays in the same hue across themes (an amber tint stays amber in
  // light mode rather than going brown).
  const themedHsl: Hsl = theme === "dark"
    ? baseHsl
    : { h: baseHsl.h, s: baseHsl.s, l: Math.max(15, baseHsl.l + LIGHT_THEME_L_DELTA) };
  const themedRgb = hexToRgb(hex); // tint base
  const accentCss = theme === "dark" ? hex : hslToCss(themedHsl);

  // Pick a contrasting --accent-text foreground. The play button's
  // icon sits on the accent fill, so we need text readable on the
  // *displayed* accent color (themed).
  const displayedRgb = theme === "dark"
    ? baseRgb
    : hslToRgbFromHsl(themedHsl);
  const lum = relativeLuminance(displayedRgb);
  const text = lum > 0.45
    ? hslToCss({ h: baseHsl.h, s: 60, l: 8 })   // dark text on bright accent
    : hslToCss({ h: baseHsl.h, s: 30, l: 96 }); // bright text on dark accent

  return {
    "--accent": accentCss,
    "--accent-text": text,
    "--accent-tint":   rgba(themedRgb, theme === "dark" ? 0.12 : 0.10),
    "--accent-tint-2": rgba(themedRgb, theme === "dark" ? 0.18 : 0.16),
    "--accent-edge":   rgba(themedRgb, theme === "dark" ? 0.35 : 0.45),
    "--accent-row-bg": rgba(themedRgb, 0.06),
  };
}

// HSL → RGB (inverse of rgbToHsl above). Only used to compute the
// displayed-accent luminance in light theme; we don't otherwise round-
// trip through HSL.
function hslToRgbFromHsl({ h, s, l }: Hsl): Rgb {
  const ss = s / 100;
  const ll = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  };
}

// Public entry. Writes the derived accent vars onto :root. The chrome
// calls this on (a) startup, (b) substrate switch, (c) theme flip.
// Idempotent — passing the same lens+theme twice rewrites the same vars.
export function applyLensTheme(lens: AnyLens, theme: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  const accent = getLensTheme(lens).accent;
  const vars = deriveAccent(accent, theme);
  const root = document.documentElement;
  for (const k of Object.keys(vars) as (keyof DerivedAccent)[]) {
    root.style.setProperty(k, vars[k]);
  }
}
