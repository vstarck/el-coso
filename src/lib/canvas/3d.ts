/* 3D-on-canvas primitives — a pinhole projector for a W×D×H box of cells and a
 * single-cube renderer (filled faces with painter-ordered edges, or a bare
 * wireframe). Pure canvas2d: no host, no store, no substrate.
 *
 * NOTE — deliberate early extraction. This kit was pulled out of the Blockoide
 * pit lens while it still has only ONE consumer, a conscious exception to the
 * "extract at the second consumer" discipline:
 * a second 3D lens is anticipated and the seam reads cleanly. If that second
 * consumer never materializes, this can fold straight back inline.
 */

export type Pt = { x: number; y: number };
export type Vec3 = readonly [number, number, number];
export type Projector = ((wx: number, wy: number, wz: number) => Pt) & {
  // World-space camera position (in box coords) — used for back-face culling.
  readonly cam: Vec3;
};

export type ProjectorOpts = {
  // Camera distance in front of the near plane, in depth units. Smaller =
  // stronger perspective (far plane shrinks more).
  camDist?: number;
  // Fraction of the min canvas dimension the near plane fills.
  fit?: number;
  // Downward look-into tilt: deep points lift toward the top of the frame.
  tilt?: number;
};

// A pinhole camera sitting in front of a W×D×H box, looking down the +z
// (depth) axis: the near plane (z=0) is the largest rectangle, the far plane
// (z=H) shrinks toward a vanishing point near screen center. A small `tilt`
// lifts deep points so the view reads as looking *into* the box. Coordinates:
// x∈[0,W] (width), y∈[0,D] (height), z∈[0,H] (depth; z=0 near, z=H far).
export function makeProjector(
  W: number,
  D: number,
  H: number,
  cw: number,
  ch: number,
  opts: ProjectorOpts = {},
): Projector {
  const camDist = opts.camDist ?? 0.62 * H;
  const fit = opts.fit ?? 0.92;
  const tilt = opts.tilt ?? 0.08;
  const halfSpan = Math.max(W, D) / 2;
  const focal = (camDist * (Math.min(cw, ch) / 2) * fit) / halfSpan;
  const ox = cw / 2;
  const oy = ch / 2;
  const Hsafe = H > 0 ? H : 1;

  // The look-into tilt lifts deep points. To keep this a true projection — so
  // a depth edge (fixed x,y, varying z) projects to a *straight* line that the
  // per-z slice corners sit exactly on — the lift must be affine in the
  // projective scale `s`, NOT linear in z. (A linear-in-z lift bends depth
  // edges, so straight depth lines drift off the slice corners.) Anchored to 0
  // at the near plane (z=0) and `tilt·ch` at the far plane (z=H); slices stay
  // axis-aligned rectangles since s + lift are constant across a z-slice.
  const s0 = focal / camDist;
  const sFar = focal / (camDist + Hsafe);
  const liftSpan = s0 - sFar || 1;

  const project = (wx: number, wy: number, wz: number): Pt => {
    const s = focal / (camDist + wz);
    const lift = (tilt * ch * (s0 - s)) / liftSpan;
    return {
      x: ox + (wx - W / 2) * s,
      y: oy + (wy - D / 2) * s - lift,
    };
  };
  // The camera sits at x=W/2, y=D/2, z=−camDist (the projection scales x/y about
  // the box center and reads depth as camDist + wz).
  return Object.assign(project, { cam: [W / 2, D / 2, -camDist] as Vec3 });
}

// A cube facet, named by its outward-normal direction. For the default camera:
// nearZ = front, farZ = back, posX = right, negX = left, posY = bottom (y is
// down on screen), negY = top.
export type CubeFace = "nearZ" | "farZ" | "posX" | "negX" | "posY" | "negY";

// Cube corner i = dx + 2·dy + 4·dz. `front` tags the −z near face (lit
// brightest by convention), `zc` is the face's depth proxy (0 near, 1 far, 0.5
// sides) used to order faces back-to-front, `face` names the facet for per-face
// coloring, `nrm` is the outward normal (drives back-face culling via a true 3D
// normal·view test — robust at grazing angles where a 2D winding test flips).
const FACES: {
  idx: number[];
  front: boolean;
  zc: number;
  face: CubeFace;
  nrm: Vec3;
}[] = [
  { idx: [0, 2, 3, 1], front: true, zc: 0, face: "nearZ", nrm: [0, 0, -1] },
  { idx: [4, 5, 7, 6], front: false, zc: 1, face: "farZ", nrm: [0, 0, 1] },
  { idx: [1, 3, 7, 5], front: false, zc: 0.5, face: "posX", nrm: [1, 0, 0] },
  { idx: [0, 4, 6, 2], front: false, zc: 0.5, face: "negX", nrm: [-1, 0, 0] },
  { idx: [6, 7, 3, 2], front: false, zc: 0.5, face: "posY", nrm: [0, 1, 0] },
  { idx: [1, 5, 4, 0], front: false, zc: 0.5, face: "negY", nrm: [0, -1, 0] },
];

// The cube's 12 edges as corner-index pairs (near face · far face · the four
// receding depth connectors). The wireframe path strokes all of them.
const EDGES: [number, number][] = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0], // −z near face
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4], // +z far face
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // depth connectors
];

// Project the 8 corners of the unit cube at (cx, cy, cz). Corner i = dx + 2·dy
// + 4·dz.
function cubeCorners(
  P: Projector,
  cx: number,
  cy: number,
  cz: number,
): Pt[] {
  const c: Pt[] = [];
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) c.push(P(cx + dx, cy + dy, cz + dz));
  return c;
}

// True 3D back-face test: the face is front-facing when its outward normal
// points back toward the camera (normal · (faceCenter − camera) < 0). Done in
// world space, so it's exact at any angle — unlike a projected-winding test,
// which the look-into lift can flip for grazing faces.
function isFrontFacing(
  cx: number,
  cy: number,
  cz: number,
  f: (typeof FACES)[number],
  cam: Vec3,
): boolean {
  const n = f.nrm;
  const dx = cx + 0.5 + 0.5 * n[0] - cam[0];
  const dy = cy + 0.5 + 0.5 * n[1] - cam[1];
  const dz = cz + 0.5 + 0.5 * n[2] - cam[2];
  return n[0] * dx + n[1] * dy + n[2] * dz < 0;
}

export type CubeStyle = {
  // Default fill for the near (front) face; lit brightest.
  front: string;
  // Default fill for every other (side / far) face.
  side: string;
  // Optional per-facet fills, keyed by outward-normal direction. A face listed
  // here wins over the front/side default — give all six for fully independent
  // facets, or just the ones you want to override.
  faces?: Partial<Record<CubeFace, string>>;
  // Edge stroke color.
  stroke: string;
  // No fill — stroke the visible silhouette only (a landing-ghost look).
  strokeOnly?: boolean;
  // Opaque hidden-surface removal: skip faces pointing away from the camera
  // (and, in `drawCubes`, faces shared with a filled neighbor). Correct for an
  // OPAQUE cube — without it, hidden faces bleed through grazing-corner seams.
  // Leave OFF when the fill carries alpha, so every face renders and the back /
  // interior faces show through the glass.
  cull?: boolean;
  // Edge stroke width (defaults: 1.5 for stroke-only / wireframe, 1 for solid).
  strokeWidth?: number;
  // Stroke all 12 edges (no back-face culling) — a transparent wireframe has
  // no fill to occlude its far/depth edges, so the full cube should show.
  wireframe?: boolean;
};

// Draw the unit cube whose near-bottom-left corner is (cx, cy, cz), projected
// through `P`. Three modes via `opt`: `wireframe` (all 12 edges, no fill),
// `strokeOnly` (visible silhouette outline), or solid — every face painted
// back-to-front, each filled then its border stroked in the same pass, so the
// edges inherit the faces' depth order (back edges hide behind opaque front
// faces, show through faded when the fill colors carry alpha).
export function drawCube(
  ctx: CanvasRenderingContext2D,
  P: Projector,
  cx: number,
  cy: number,
  cz: number,
  opt: CubeStyle,
): void {
  const c = cubeCorners(P, cx, cy, cz);

  if (opt.wireframe) {
    ctx.lineWidth = opt.strokeWidth ?? 1.5;
    ctx.strokeStyle = opt.stroke;
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      ctx.moveTo(c[a]!.x, c[a]!.y);
      ctx.lineTo(c[b]!.x, c[b]!.y);
    }
    ctx.stroke();
    return;
  }

  const faceFront = (f: (typeof FACES)[number]): boolean =>
    isFrontFacing(cx, cy, cz, f, P.cam);

  // Trace a face's outline as the current path; the caller fills / strokes it.
  const facePath = (f: (typeof FACES)[number]): void => {
    const poly = f.idx.map((i) => c[i]!);
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x, poly[0]!.y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
    ctx.closePath();
  };

  // Landing ghost: no fill, just the visible silhouette (front-facing faces,
  // far face excluded).
  if (opt.strokeOnly) {
    ctx.lineWidth = opt.strokeWidth ?? 1.5;
    ctx.strokeStyle = opt.stroke;
    for (const f of FACES) {
      if (!f.front && f.zc === 1) continue; // far face never shows
      if (!faceFront(f)) continue;
      facePath(f);
      ctx.stroke();
    }
    return;
  }

  // Solid / translucent: every face back-to-front, each FILLED then its border
  // STROKED in the same pass, so the edges inherit the faces' depth order. Back
  // faces (and their edges) draw first; front faces paint over them when opaque
  // and show through faded when alpha < 1 — no separate on-top edge pass, so
  // back edges no longer float over the cube. (Each edge is shared by two faces
  // and so stroked twice; uniform across all 12, so just a touch heavier.)
  const ordered = [...FACES].sort((a, b) => {
    const fa = faceFront(a) ? 1 : 0;
    const fb = faceFront(b) ? 1 : 0;
    if (fa !== fb) return fa - fb; // back faces first, front faces last
    return b.zc - a.zc; // within a group, the deeper face first
  });
  const faces = opt.cull ? ordered.filter(faceFront) : ordered;
  ctx.lineWidth = opt.strokeWidth ?? 1;
  ctx.strokeStyle = opt.stroke;
  for (const f of faces) {
    facePath(f);
    ctx.fillStyle = opt.faces?.[f.face] ?? (f.front ? opt.front : opt.side);
    ctx.fill();
    ctx.stroke();
  }
}

export type CubeInstance = {
  x: number;
  y: number;
  z: number;
  style: CubeStyle;
};

// Draw many cubes with a single GLOBAL, face-level back-to-front pass — the fix
// for inter-cube artifacts that per-cube rendering can't resolve (e.g. a lower
// cube's top face peeking through where the neighbor above should occlude it):
// each cube orders its own faces in isolation, but interlocking geometry needs
// every face sorted together. Faces from every cube are collected, depth-sorted
// by each face centroid's true distance from the camera, and painted far→near,
// so nearer faces cover the ones behind them across cube boundaries. (A coarse
// `z + zc` key ties all side faces and mis-orders neighbors; the real distance
// separates them.) When a cube sets `cull` (opaque), faces shared with a filled
// neighbor are dropped too — interior faces are never visible from outside, and
// distance sorting alone can't separate the equidistant faces of one cube; a
// translucent cube keeps `cull` off so all faces render through the glass.
// Fill-mode cubes go through this; wireframe / stroke-only cubes have no fills
// to order and delegate to `drawCube`.
export function drawCubes(
  ctx: CanvasRenderingContext2D,
  P: Projector,
  cubes: ReadonlyArray<CubeInstance>,
): void {
  type FaceDraw = {
    depth: number;
    pts: Pt[];
    fill: string;
    stroke: string;
    lineWidth: number;
  };
  const draws: FaceDraw[] = [];
  const occupied = new Set(cubes.map(({ x, y, z }) => `${x},${y},${z}`));
  for (const { x, y, z, style } of cubes) {
    if (style.wireframe || style.strokeOnly) {
      drawCube(ctx, P, x, y, z, style); // no fills to order
      continue;
    }
    const c = cubeCorners(P, x, y, z);
    const cam = P.cam;
    for (const f of FACES) {
      if (style.cull) {
        // Opaque hidden-surface removal: drop faces pointing away, and faces
        // shared with a filled neighbor (interior — never visible from
        // outside). A translucent cube leaves `cull` off so every face renders
        // and nothing is incomplete through the glass.
        if (!isFrontFacing(x, y, z, f, cam)) continue;
        const nx = x + f.nrm[0];
        const ny = y + f.nrm[1];
        const nz = z + f.nrm[2];
        if (occupied.has(`${nx},${ny},${nz}`)) continue;
      }
      // True camera distance of the face centroid (cube center + ½ normal).
      const ddx = x + 0.5 + 0.5 * f.nrm[0] - cam[0];
      const ddy = y + 0.5 + 0.5 * f.nrm[1] - cam[1];
      const ddz = z + 0.5 + 0.5 * f.nrm[2] - cam[2];
      draws.push({
        depth: ddx * ddx + ddy * ddy + ddz * ddz,
        pts: f.idx.map((i) => c[i]!),
        fill: style.faces?.[f.face] ?? (f.front ? style.front : style.side),
        stroke: style.stroke,
        lineWidth: style.strokeWidth ?? 1,
      });
    }
  }
  draws.sort((a, b) => b.depth - a.depth); // far faces first
  for (const d of draws) {
    ctx.beginPath();
    ctx.moveTo(d.pts[0]!.x, d.pts[0]!.y);
    for (let i = 1; i < d.pts.length; i++) ctx.lineTo(d.pts[i]!.x, d.pts[i]!.y);
    ctx.closePath();
    ctx.fillStyle = d.fill;
    ctx.fill();
    ctx.lineWidth = d.lineWidth;
    ctx.strokeStyle = d.stroke;
    ctx.stroke();
  }
}
