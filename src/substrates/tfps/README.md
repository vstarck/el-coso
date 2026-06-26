# tfps — terminal FPS

A Wolfenstein-3D-style **raycaster** whose single lens renders the world as
**120-column colored ASCII** drawn onto a canvas, dressed in the terminal/CRT
kit for an Akira-arcade look. A patrol bot self-plays on load; the arrow keys
take over.

**A portfolio showcase, not a thesis substrate.** El Coso is about *indirect*
agency — nudging a system you don't directly control. tfps is the opposite
(direct movement), so it demonstrates the render/lens/host stack, not the IP.
The one genuinely El-Coso idea it makes literal: **a 3D renderer is a Lens with
a non-trivial forward operator** (`State` → projected columns). v1 is a pure
walkthrough — no combat.

## How it works

- **Engine** (`engine/`) — State is just the camera: a continuous `(px, py)` in
  map cells plus a facing `angle`. A plain object (no channels — one camera, not
  a population), so it keyframes trivially. The world (a grid of wall kinds) is
  immutable `Config`. `tick` rotates then translates with **per-axis
  wall-sliding collision**. No RNG — locomotion is fully deterministic.
- **Raycaster** (`lens/raycast.ts`) — textbook grid DDA, one ray per screen
  column, reporting **perpendicular** distance (no edge fisheye), the face side
  (N/S vs E/W), and the wall kind. Pure and headless-testable.
- **Render** (`lens/render.ts`) — columns → a styled ASCII cell buffer
  (`lib/ascii`): ceiling/floor as cheap vertical bg gradients, walls as a
  distance-faded glyph ramp tinted by kind and darkened on E/W faces. Drawn to a
  `<canvas>` in glyph mode (120 colored characters wide). The projection plane
  is derived from the canvas aspect, so the view is undistorted (~67° FOV).
- **Bot** (`lens/bot.ts`) — deterministic steering: probe ahead + to the sides,
  walk when clear, turn toward the more open side at a wall. Same circuit every
  load (good for a looping showpiece).
- **Frame** — the terminal/CRT kit (`@/lib/terminal`, `classPrefix: "tfps"`)
  gives the focusable screen, scanlines, wobble, background, and the command
  line beneath the view. React-free; exports to a self-contained widget.

## Controls

- **▲ / ▼** — move forward / back
- **◄ / ►** — turn left / right
- **, / .** — strafe left / right
- Command line: `restart`, `auto` (toggle self-play), `pause`, `play`,
  `theme <neon|amber|green>`, `help`.

Movement is arrows + punctuation only: the command line consumes letters/digits,
so movement stays out of its way (the same resolution tts reached).

## Levels

`puzzles/*.json` — the map is authored as equal-length rows of glyphs (`#` and
digits `1`–`9` are wall kinds; `.`/space are floor), with a spawn pose and
locomotion rates. `e1m1` is the first level.

## Tests

`tests/tfps.test.ts` — level parse, movement, wall collision, turning,
determinism, raycaster distances, and a bot self-play run that wanders the real
level without ever clipping into a wall.
