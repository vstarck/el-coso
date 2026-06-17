/* Velocity overlay — reveals `pos − prev`, the quantity Verlet structurally
 * hides (no velocity is ever stored). The always-lively overlay in a pure-DVD
 * scene. */

import { createVectorOverlay, PALETTE, particleVel } from "./shared";

export const dvdVelocityLens = createVectorOverlay({
  id: "dvd-velocity",
  name: "Velocity",
  color: PALETTE.velocity,
  gain: 6,
  vector: (s) => particleVel(s),
});
