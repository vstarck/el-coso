/* tfps substrate state — a first-person camera in a 2D grid world.
 *
 * The whole substrate State is the camera: a continuous position `(px, py)` in
 * map-cell units and a facing `angle` in radians. The world itself (the wall
 * grid) is immutable Config, not State — so State is tiny, plain, and trivially
 * keyframable. No channels: there is one "entity" (the player), not a population.
 *
 * Convention: map `y` increases downward (row index). `angle` 0 faces +x (east);
 * increasing `angle` rotates clockwise (toward +y). `dir = (cos a, sin a)`.
 */
export type SubstrateState = {
  tick: number;
  px: number; // camera x, in map cells (fractional)
  py: number; // camera y, in map cells (fractional)
  angle: number; // facing, radians
};

// Per-tick movement intent. Held inputs (a key down for several ticks is the
// same value repeated). No combat in v1 — pure locomotion.
export type TfpsInputs = {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
};

export const NO_INPUT: TfpsInputs = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
};
