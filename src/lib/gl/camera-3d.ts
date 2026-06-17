/* 3D perspective camera tracking a look-at point on a sphere surface
 *. Owns sphere-surface look-at, altitude, tilt,
 * sun direction; per-frame derives projection + view matrices for shader
 * uniforms and implements click-to-world unprojection via ray-sphere
 * intersection.
 *
 * Coordinate convention follows the sandbox demo:
 * - World +Y is north (sphere axis), +X is east (towards lon = +π/2),
 *   +Z is towards the patch center (lon = 0, lat = 0 sits on +Z).
 * - Sphere is centered at origin with radius `sphere_radius`.
 * - The substrate patch is anchored at (lon = 0, lat = 0) with half-
 *   extents derived from `world_width / (4π R)` (longitude) and
 *   `world_height / (2π R)` (latitude).
 *
 * Matrices are column-major Float32Array (length 16). Pass directly to
 * `gl.uniformMatrix4fv(loc, false, matrix)`.
 *
 * `pan`-style mutation: `look_at_lon`, `look_at_lat`, `altitude`, `tilt`,
 * `sun_dir` are public mutable fields. `refresh(canvas)` recomputes the
 * derived matrices from current state; call once per frame before
 * drawing.
 */

export type Vec3 = [number, number, number];

export type Camera3DOpts = {
  /** Physical world width (substrate.W × cell-size). Used to size the
   * patch window on the sphere — half-extent in sphere-UV space is
   * `world_width / (4π × sphere_radius)`. */
  world_width: number;
  /** Physical world height (substrate.H × cell-size). */
  world_height: number;
  /** Sphere radius in the same units as world_width/_height. The
   * curvature dial — typical authoring range 1× to 100× world_width. */
  sphere_radius: number;
  /** Initial look-at on the sphere (radians; default 0/0 = patch
   * center). */
  look_at_lon?: number;
  look_at_lat?: number;
  /** Initial altitude above the surface (world units). */
  altitude?: number;
  /** Fixed view tilt (radians; 0 = straight down, ~π/2 = horizon). */
  tilt?: number;
  /** Sun direction in world space (auto-normalized). */
  sun_dir?: Vec3;
  /** Perspective field-of-view in degrees (default 50). */
  fov_deg?: number;
};

export type Camera3DUnprojectResult =
  | { kind: "world"; world_x: number; world_y: number }
  | { kind: "off_world"; lon: number; lat: number }
  | { kind: "missed" };

export type Camera3D = {
  // Geometry config — public for runtime tunables (sphere_radius dial,
  // tilt slider, sun direction). `world_width`/`world_height` are stable
  // for the lens's lifetime (puzzle-bound); mutating them is allowed but
  // unusual.
  world_width: number;
  world_height: number;
  sphere_radius: number;
  fov_deg: number;
  // Mutable camera state — pan-drag and zoom update these directly.
  look_at_lon: number;
  look_at_lat: number;
  altitude: number;
  // Authored, typically not mutated at runtime.
  tilt: number;
  sun_dir: Vec3;
  // Derived per-frame — read after refresh().
  view_matrix: Float32Array;
  projection_matrix: Float32Array;
  camera_position: Vec3;
  /** Sphere-UV half-extents of the substrate patch. Patch occupies
   * `(2·patch_half_u, 2·patch_half_v)` in UV space; shrinks as
   * `sphere_radius` grows. */
  patch_half_u: number;
  patch_half_v: number;
  /** Recompute matrices + patch sizing from current state. Call once
   * per frame before drawing. */
  refresh: (canvas: HTMLCanvasElement) => void;
  /** Convert a canvas-pixel click to a substrate-world cell coordinate
   * via ray-sphere intersection. Returns `world` when the ray hits the
   * patch, `off_world` (with sphere lon/lat) when it hits the sphere
   * outside the patch, and `missed` when the ray clears the sphere. */
  unproject_click: (
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
  ) => Camera3DUnprojectResult;
  destroy: () => void;
};

export function createCamera3D(opts: Camera3DOpts): Camera3D {
  const view_matrix = new Float32Array(16);
  const projection_matrix = new Float32Array(16);

  const cam: Camera3D = {
    world_width: opts.world_width,
    world_height: opts.world_height,
    sphere_radius: opts.sphere_radius,
    fov_deg: opts.fov_deg ?? 50,
    look_at_lon: opts.look_at_lon ?? 0,
    look_at_lat: opts.look_at_lat ?? 0,
    altitude: opts.altitude ?? 2.5,
    tilt: opts.tilt ?? (50 * Math.PI) / 180,
    sun_dir: normalize3(opts.sun_dir ?? [1, 0, 0]),
    view_matrix,
    projection_matrix,
    camera_position: [0, 0, 0],
    patch_half_u: 0,
    patch_half_v: 0,
    refresh: (canvas) => {
      const R = cam.sphere_radius;
      const cosLat = Math.cos(cam.look_at_lat);
      const sinLat = Math.sin(cam.look_at_lat);
      const cosLon = Math.cos(cam.look_at_lon);
      const sinLon = Math.sin(cam.look_at_lon);

      // Look-at point on the sphere at (lon, lat).
      const lx = R * cosLat * sinLon;
      const ly = R * sinLat;
      const lz = R * cosLat * cosLon;

      // Outward surface normal.
      const nx = lx / R;
      const ny = ly / R;
      const nz = lz / R;

      // Camera = look-at + altitude × outward normal.
      const eye: Vec3 = [
        lx + nx * cam.altitude,
        ly + ny * cam.altitude,
        lz + nz * cam.altitude,
      ];
      cam.camera_position = eye;

      // Tangent-up = projection of world-Y onto the tangent plane at
      // look-at. Doubles as the "forward/north" direction tilt rotates
      // the view toward.
      let tux = -nx * ny;
      let tuy = 1 - ny * ny;
      let tuz = -nz * ny;
      const tlen = Math.hypot(tux, tuy, tuz);
      if (tlen > 1e-5) {
        tux /= tlen;
        tuy /= tlen;
        tuz /= tlen;
      } else {
        // Pole singularity fallback (look-at at the pole). Pick an
        // arbitrary tangent.
        tux = 0;
        tuy = 0;
        tuz = 1;
      }

      // Look direction = mix(straight-down=-normal, tangent_up=forward)
      // by tilt. tilt = 0 → straight down; tilt = π/2 → along tangent.
      const cosT = Math.cos(cam.tilt);
      const sinT = Math.sin(cam.tilt);
      const ldx = -nx * cosT + tux * sinT;
      const ldy = -ny * cosT + tuy * sinT;
      const ldz = -nz * cosT + tuz * sinT;

      // Look-target — a point along the look direction from the eye.
      // Distance is arbitrary for camera orientation; altitude keeps it
      // proportional.
      const tx = eye[0] + ldx * cam.altitude;
      const ty = eye[1] + ldy * cam.altitude;
      const tz = eye[2] + ldz * cam.altitude;

      // View matrix.
      lookAt(view_matrix, eye, [tx, ty, tz], [tux, tuy, tuz]);

      // Projection matrix. Near/far scale with R so a 1×W sphere and a
      // 100×W sphere both stay in the depth-buffer's precision sweet spot.
      const aspect = Math.max(1, canvas.width) / Math.max(1, canvas.height);
      perspective(
        projection_matrix,
        (cam.fov_deg * Math.PI) / 180,
        aspect,
        Math.max(0.001 * R, 0.001),
        10 * R,
      );

      // Patch sizing — sphere-UV half-extents from world physical size.
      // Longitude total range 2π → 1.0 UV → half-extent = W / (4π R).
      // Latitude total range π → 1.0 UV → half-extent = H / (2π R).
      cam.patch_half_u = cam.world_width / (4 * Math.PI * R);
      cam.patch_half_v = cam.world_height / (2 * Math.PI * R);
    },
    unproject_click: (canvas, x, y) => {
      // Normalized device coordinates [-1, 1].
      const w = Math.max(1, canvas.width);
      const h = Math.max(1, canvas.height);
      // Canvas-pixel y is top-down; NDC y is bottom-up.
      const ndc_x = (x / w) * 2 - 1;
      const ndc_y = 1 - (y / h) * 2;

      // Inverse(projection × view) — unproject a point on the near plane.
      const pv = new Float32Array(16);
      multiply4(pv, projection_matrix, view_matrix);
      const inv = new Float32Array(16);
      if (!invert4(inv, pv)) return { kind: "missed" };

      // Near-plane point in world space.
      const np = transformPoint(inv, [ndc_x, ndc_y, -1]);
      const eye = cam.camera_position;
      const dx = np[0] - eye[0];
      const dy = np[1] - eye[1];
      const dz = np[2] - eye[2];
      const dlen = Math.hypot(dx, dy, dz);
      if (dlen < 1e-9) return { kind: "missed" };
      const rx = dx / dlen;
      const ry = dy / dlen;
      const rz = dz / dlen;

      // Solve |eye + t·dir|² = R². a = 1, b = 2·dir·eye, c = |eye|² − R².
      const b = 2 * (rx * eye[0] + ry * eye[1] + rz * eye[2]);
      const c =
        eye[0] * eye[0] +
        eye[1] * eye[1] +
        eye[2] * eye[2] -
        cam.sphere_radius * cam.sphere_radius;
      const disc = b * b - 4 * c;
      if (disc < 0) return { kind: "missed" };
      const sq = Math.sqrt(disc);
      const t0 = (-b - sq) / 2;
      const t1 = (-b + sq) / 2;
      const t = t0 > 1e-6 ? t0 : t1 > 1e-6 ? t1 : -1;
      if (t < 0) return { kind: "missed" };

      const px = eye[0] + rx * t;
      const py = eye[1] + ry * t;
      const pz = eye[2] + rz * t;

      const R = cam.sphere_radius;
      const lat = Math.asin(Math.max(-1, Math.min(1, py / R)));
      const lon = Math.atan2(px, pz);

      // Check the patch window (centered at lon = lat = 0). Half-extents
      // come from the sandbox geometry: U → longitude (×2π), V → lat (×π).
      // local.x = lon / (2π · uPatchHalfU) = lon · R · 2 / world_width
      const local_x = (lon * 2 * R) / cam.world_width;
      const local_y = (lat * 2 * R) / cam.world_height;
      if (Math.abs(local_x) <= 1 && Math.abs(local_y) <= 1) {
        // Patch UV is mapped so (lat = 0, lon = 0) → world center, +X lon
        // → +world_x (east → right), +Y lat → -world_y (north → top).
        const world_x = (local_x + 1) * 0.5 * cam.world_width;
        const world_y = (1 - (local_y + 1) * 0.5) * cam.world_height;
        return { kind: "world", world_x, world_y };
      }
      return { kind: "off_world", lon, lat };
    },
    destroy: () => {
      // No GPU resources owned. Method ships for lifecycle symmetry with
      // the other primitives.
    },
  };

  return cam;
}

// === Matrix helpers ======================================================

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-9) return [0, 0, 1];
  return [v[0] / l, v[1] / l, v[2] / l];
}

function lookAt(out: Float32Array, eye: Vec3, target: Vec3, up: Vec3): void {
  // Forward = normalize(target - eye); right = normalize(cross(forward, up));
  // newUp = cross(right, forward). Column-major.
  const fx = target[0] - eye[0];
  const fy = target[1] - eye[1];
  const fz = target[2] - eye[2];
  let flen = Math.hypot(fx, fy, fz);
  if (flen < 1e-9) flen = 1;
  const f0 = fx / flen;
  const f1 = fy / flen;
  const f2 = fz / flen;

  // right = f × up
  let rx = f1 * up[2] - f2 * up[1];
  let ry = f2 * up[0] - f0 * up[2];
  let rz = f0 * up[1] - f1 * up[0];
  let rlen = Math.hypot(rx, ry, rz);
  if (rlen < 1e-9) rlen = 1;
  rx /= rlen; ry /= rlen; rz /= rlen;

  // up' = r × f
  const ux = ry * f2 - rz * f1;
  const uy = rz * f0 - rx * f2;
  const uz = rx * f1 - ry * f0;

  // View matrix column-major (rows of rotation are basis vectors,
  // translation in last column is the negated eye in the basis).
  out[0] = rx;   out[1] = ux;  out[2] = -f0; out[3] = 0;
  out[4] = ry;   out[5] = uy;  out[6] = -f1; out[7] = 0;
  out[8] = rz;   out[9] = uz;  out[10] = -f2; out[11] = 0;
  out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] =  (f0 * eye[0] + f1 * eye[1] + f2 * eye[2]);
  out[15] = 1;
}

function perspective(
  out: Float32Array,
  fov_y: number,
  aspect: number,
  near: number,
  far: number,
): void {
  const f = 1 / Math.tan(fov_y / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0;             out[3] = 0;
  out[4] = 0;          out[5] = f; out[6] = 0;             out[7] = 0;
  out[8] = 0;          out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0;         out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
}

function multiply4(out: Float32Array, a: Float32Array, b: Float32Array): void {
  // Column-major. out = a × b.
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4]!;
    const b1 = b[i * 4 + 1]!;
    const b2 = b[i * 4 + 2]!;
    const b3 = b[i * 4 + 3]!;
    out[i * 4]     = a[0]! * b0 + a[4]! * b1 + a[8]!  * b2 + a[12]! * b3;
    out[i * 4 + 1] = a[1]! * b0 + a[5]! * b1 + a[9]!  * b2 + a[13]! * b3;
    out[i * 4 + 2] = a[2]! * b0 + a[6]! * b1 + a[10]! * b2 + a[14]! * b3;
    out[i * 4 + 3] = a[3]! * b0 + a[7]! * b1 + a[11]! * b2 + a[15]! * b3;
  }
}

function invert4(out: Float32Array, m: Float32Array): boolean {
  // Standard 4×4 inverse via cofactor expansion (gl-matrix style).
  const a00 = m[0]!,  a01 = m[1]!,  a02 = m[2]!,  a03 = m[3]!;
  const a10 = m[4]!,  a11 = m[5]!,  a12 = m[6]!,  a13 = m[7]!;
  const a20 = m[8]!,  a21 = m[9]!,  a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  const inv_det = 1 / det;
  out[0]  = ( a11 * b11 - a12 * b10 + a13 * b09) * inv_det;
  out[1]  = (-a01 * b11 + a02 * b10 - a03 * b09) * inv_det;
  out[2]  = ( a31 * b05 - a32 * b04 + a33 * b03) * inv_det;
  out[3]  = (-a21 * b05 + a22 * b04 - a23 * b03) * inv_det;
  out[4]  = (-a10 * b11 + a12 * b08 - a13 * b07) * inv_det;
  out[5]  = ( a00 * b11 - a02 * b08 + a03 * b07) * inv_det;
  out[6]  = (-a30 * b05 + a32 * b02 - a33 * b01) * inv_det;
  out[7]  = ( a20 * b05 - a22 * b02 + a23 * b01) * inv_det;
  out[8]  = ( a10 * b10 - a11 * b08 + a13 * b06) * inv_det;
  out[9]  = (-a00 * b10 + a01 * b08 - a03 * b06) * inv_det;
  out[10] = ( a30 * b04 - a31 * b02 + a33 * b00) * inv_det;
  out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * inv_det;
  out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * inv_det;
  out[13] = ( a00 * b09 - a01 * b07 + a02 * b06) * inv_det;
  out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * inv_det;
  out[15] = ( a20 * b03 - a21 * b01 + a22 * b00) * inv_det;
  return true;
}

function transformPoint(m: Float32Array, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  const inv_w = w === 0 ? 1 : 1 / w;
  return [
    (m[0]! * x + m[4]! * y + m[8]!  * z + m[12]!) * inv_w,
    (m[1]! * x + m[5]! * y + m[9]!  * z + m[13]!) * inv_w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * inv_w,
  ];
}
