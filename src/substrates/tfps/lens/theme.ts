/* tfps themes — the look of the 3D view + the CRT frame around it. Richer than
 * the terminal kit's text-only THEMES (this is a colored raycaster, not a JSON
 * dump), so tfps defines its own palette set using the same idea: one named
 * entity owns the whole appearance.
 *
 * `walls` maps a wall *kind* (the map glyph's value) to a base color; the
 * renderer shades it by distance + face side. Ceiling/floor are vertical
 * gradients (top→bottom), giving the scene depth for nearly free (cell bg fills,
 * no glyphs). `crt` drives the terminal kit's CRT treatment on the frame.
 */
export type TfpsTheme = {
  bg: string; // screen background (behind everything; also the terminal bg)
  accent: string; // command-line text + chrome accent
  ceilingTop: string; // sky/ceiling at the top of the view
  ceilingBottom: string; // ceiling near the horizon
  floorNear: string; // floor at the bottom (closest)
  floorFar: string; // floor near the horizon
  walls: Record<number, string>; // wall kind → base color
  crt: boolean;
};

export const THEMES: Record<string, TfpsTheme> = {
  // The Akira-arcade default: neon walls on near-black, a cold blue ceiling and
  // a warm-to-cool floor. CRT on.
  neon: {
    bg: "#04060d",
    accent: "#39f0ff",
    ceilingTop: "#0a0f24",
    ceilingBottom: "#161d3a",
    floorNear: "#241a32",
    floorFar: "#0c0a16",
    walls: { 1: "#ff2bd6", 2: "#39f0ff", 3: "#ffd23f", 4: "#7cff5a" },
    crt: true,
  },
  // Amber monochrome — a vector-arcade / old-terminal feel.
  amber: {
    bg: "#0a0600",
    accent: "#ffb000",
    ceilingTop: "#1a0f00",
    ceilingBottom: "#2a1a00",
    floorNear: "#241800",
    floorFar: "#0c0800",
    walls: { 1: "#ffb000", 2: "#ff8c00", 3: "#ffd060", 4: "#cc7000" },
    crt: true,
  },
  // Green phosphor — the classic terminal CRT.
  green: {
    bg: "#020a04",
    accent: "#33ff66",
    ceilingTop: "#031a0c",
    ceilingBottom: "#06270f",
    floorNear: "#052012",
    floorFar: "#020a06",
    walls: { 1: "#33ff66", 2: "#22cc55", 3: "#7dffa0", 4: "#119944" },
    crt: true,
  },
};

export const DEFAULT_THEME = "neon";

export function resolveTheme(name: string): TfpsTheme {
  return THEMES[name] ?? THEMES[DEFAULT_THEME]!;
}
