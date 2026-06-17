# `src/lib/canvas/` — shared Canvas2D lens helpers

**Chrome-tier. May import DOM, `useStore`, `historyTick`. Not
translatable.**

Helpers for lenses whose render target is `canvas2d`. Picked by the
*design-questions pipeline* (Q1 = canvas2d → import the pieces you need
from here).

Extracted helpers:

- **`sizing.ts`** — `attachCanvasSizing(canvas, { onResize? })` —
  backing-buffer sync + window-resize handler. Consumers: conway,
  canvas lenses. `onResize` body varies per lens
  (re-center pan, re-render, neither).
- **`pan-drag.ts`** — `attachPanDrag(canvas, { pan, onPan?,
  dragCursor?, idleCursor? })` — middle-mouse or shift+left pan with
  in-place mutation of a shared `pan` object. Exposes `dragDistance()`
  for trailing-click suppression and `isDragging()` for hover-preview
  suppression. Consumers: conway, canvas lenses.
- **`brush.ts`** — `attachBrush(canvas, { projectCell, onStamp,
  spacingCells?, spacingMs?, suppress? })` — plain-left click/drag as a
  stream of decimated cell stamps. Click = one stamp; drag =
  stroke with spatial-AND-temporal throttling. Lens supplies the
  cursor → cell projector; kit owns the gesture state machine. Disjoint
  from `pan-drag` by default `suppress` (skips shift+left and non-left
  buttons). Consumers: brush-input lenses.
- **`3d.ts`** — `makeProjector(W,D,H,cw,ch,opts)` (pinhole camera for a
  W×D×H box, tilt-correct so depth lines stay straight) + `drawCube(ctx, P,
  cx, cy, cz, style)` (a unit cube as solid painter-ordered faces, a visible
  silhouette, or a full wireframe). Pure — no store/DOM-host. **Deliberate
  early extraction: one consumer so far** (Blockoide pit / playground),
  pulled out ahead of the second-consumer rule by explicit choice,
  anticipating a second 3D lens. Folds back inline cleanly if that never
  lands.

Still longhand (extract when needed):

- `hover-pick.ts` — TBD per substrate (pixel → cell mapping varies).
