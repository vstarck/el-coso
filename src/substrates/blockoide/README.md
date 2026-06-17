# blockoide

An ASCII implementation of **Blockout** (1989) — 3D Tetris. Polycubes fall
down a `W×D×H` well viewed from directly above; the player slides the piece
in the cross-section plane and rotates it about three axes; a completed
horizontal layer (a constant-depth slice) clears.

The package is the project's **reference `ascii` substrate**: the well is a
pure styled cell buffer (the ASCII render kit)
materialized into a `<pre>`, and *all* input is keyboard or a sibling DOM
HUD — never the render itself.

## Layout

- `engine/` — platform-agnostic `(State, Causality)`. `cells` is one
  doubled `Uint8Array` of length `W·D·H` (`z·W·D + y·W + x`); the falling
  piece is scalars. The seven tetracubes ship precomputed orientation sets
  + rotation transition tables (`pieces.ts`); rotation is a table lookup on
  a hashable `orient` integer. Permanent obstacles are cells valued `WALL`
  (255); they satisfy a layer but never clear, and collapse is a per-column
  shift-by-one that a wall bounds.
- `lens/` — one orchestrating **deck** lens (`blockoide-deck`, the substrate's
  single registered lens) that composes the chrome-less HUD furniture with a
  swappable center **view**. Structure:
  - `deck-core.ts` — the **store-free composer**: builds the HUD (title =
    inline `assets/logo.svg`; altimeter; stats + NEXT; controls + transport
    buttons; outcome + credits overlay), owns the controller, mounts the
    active view. Depends on its host only through injected `DeckHostHooks`.
  - `deck.ts` — the thin full-app `Lens` wrapper: wires the hooks to the
    Zustand store + supplies the chrome-facing API (commitGlyph, outcomeFor,
    hudMetrics). Injects `deck.css` + `style.css` globally.
  - `controller.ts` — `DeckController`, the **sole history surface**
    (store-free): keyboard input, the replay-aware tick loop, `rewindBy`
    (`historyTruncate` take-back) / `restart` (`historyReset`).
  - `view/{shaft,pit,well}.ts` — the **center views**, render-only
    (`make…View(slot, config) → { renderFrom(state), … }`; never touch
    history/input/tick):
    - **shaft** (default) — the 3D pit in **pure ASCII**: depth slices as
      `<pre>`s CSS-scaled by depth + stacked so the stack *is* the tunnel.
      `perspective` tunable.
    - **pit** — the same view via real **canvas2d** projection
      (`project.ts`): depth-sorted, back-face-culled cubes + landing ghost.
      `tilt` / `ghost` tunables.
    - **well** — the ASCII top-down view: a small-font `<pre>` with each cell
      a block of legible characters (`ssx ≈ 1.67·ssy`). `cell_chars` tunable.
  The falling piece draws translucent so its deeper cells read through it.
- `puzzles/` — `sprint` (4×4×10, clear 8), `endless` (4×4×12, survival),
  `pillar` (5×5×10 with a full-height center obstacle).

## Controls

`←→↑↓` move in the plane · `q/e` `a/d` `w/s` rotate about the three axes ·
`Shift` soft drop · `Enter` hard drop. (`Space` stays the chrome's
play/pause.)

## Render tunables

- `cell_chars` — rows of characters per game cell: `2` (the minimum 3×2
  block) · `4` · `6` (default, a 10×6 block) · `8`. Columns follow the
  monospace aspect so cells stay square. More = a larger, denser well.
- `glyph_set` — swaps the role→glyph dictionary live: `blocks` (`█`,
  depth via color), `shaded` (depth as a `█▓▒░` ramp + color), or `retro`
  (`#`/`@`/`.`). The fill character is what each cell's block is tiled with.

## Embedding (chrome-less, single JS file)

Blockoide ships as a **react-less, store-less embeddable bundle** —
`npm run build:embed` → one self-contained `dist-embed/blockoide-embed.js`
(~106 KB / ~30 KB gz) that mounts a fully-playable instance into any page
inside a Shadow root (two-way style isolation, no font, no asset requests):

```html
<div id="blockoide"></div>
<script src="blockoide-embed.js"></script>
<script>Blockoide.mountBlockoide("#blockoide");</script>
```

The entry is `src/embed/blockoide.ts`; full usage + how it stays react-less
is in [`src/embed/README.md`](../../embed/README.md). Dev preview:
`npm run dev`, then `/src/embed/blockoide.html`.
