# tts

The simplest possible Tetris, as an El Coso substrate.

- **Board** — 10×20 well. Settled blocks live in one doubled `Uint8Array`
  channel (`cells`, value = `kind + 1`); the falling piece is scalars.
- **Pieces** — the seven classic tetrominoes `I O T S Z J L`. The letter is
  the piece's glyph. Rotation is computed (`(x, y) → (-y, x)` + renormalize)
  with simple wall kicks.
- **Rules** — gravity auto-falls; full rows clear; topping out loses. Endless
  by default (`win_lines: 0`).

## Controls

| key | action |
|-----|--------|
| ◀ / ▶ | move (held, auto-repeats) |
| ▲ | rotate clockwise |
| ▼ or Space | drop to floor + lock |

## Lens — `tts-json`

A `target_kind: "dom"` lens that is *just a JSON view of the state*:
`JSON.stringify(view, null, 2)` into a `<pre>`, re-rendered each tick. The
`board` field is an array of equal-length row strings — one glyph per cell
(`.` = empty), so pieces read by character, not color. `BOUNDED`, 640px wide,
height grows with the readout.

### Theme

The lens's whole look is one entity — the `theme` enum tunable — bundling
**text color + terminal background + CRT on/off**:

- `default` — green phosphor text on the host's dark backdrop, CRT on.
- `boomer-blue` — white characters on a deep DOS-blue screen, CRT on.
- `modern` — soft grey on charcoal, a crisp no-CRT look.

Set in chrome, via `--set theme=modern`, or with the `theme NAME` command.

### CRT effect

A pure-CSS+JS (no canvas) CRT treatment: a slow screen **wobble** + phosphor
flicker, **scanlines** (a `repeating-linear-gradient` overlay), and a phosphor
**blur + glow** (`filter: blur()` + a `text-shadow` tinted to the text color).
Whether it's on is owned by the theme (above).

- **Tuning** — every amount lives in the `CRT` constants block at the top of
  `lens/crt.ts`; edit + rebuild. Each sub-effect (`wobble` / `scanlines` /
  `blur`) has its own `enabled` flag, so 2 and 3 toggle off by a constant edit
  independent of the theme's master switch.

## Embed

```
npm run export -- tts                  # dist-embed/tts.html (self-contained)
npm run export -- tts --set theme=modern --speed=2x
npm run export -- tts --set font_size=24
```

`font_size` is an **embed-only** tunable — settable via `--set` but absent
from the lens's `tunables`, so it never appears in the chrome. (The mount
pipeline routes undeclared tunable paths straight to the lens's `setTunable`.)

The lens talks to its host only through the injected `LensHost`, so the
export bundles React-free.

### Multiple sandboxes per page

Keyboard is **element-scoped**: the screen wrapper (`.tts-crt-screen`) is
focusable and listeners attach to it, so only the focused sandbox responds —
several embeds can share a page. The wrapper gets a **`tts-focused`** class
while focused, so the host page can theme the active one:

```css
.tts-crt-screen.tts-focused { box-shadow: 0 0 0 1px #33ff66; }
```
