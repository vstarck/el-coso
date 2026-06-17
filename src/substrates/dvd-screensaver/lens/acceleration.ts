/* Acceleration overlay — reveals the emitted field acceleration (gravity +
 * jitter) for this tick. Near-zero in a pure-DVD scene (jitter only); comes
 * alive and points down once gravity is on. Wall bounces are impulsive and
 * deliberately absent here — they show as a flip in the velocity overlay. */

import { createVectorOverlay, PALETTE } from "./shared";

export const dvdAccelerationLens = createVectorOverlay({
  id: "dvd-acceleration",
  name: "Acceleration",
  color: PALETTE.acceleration,
  gain: 200,
  vector: (s) => ({ x: s.ax[0] ?? 0, y: s.ay[0] ?? 0 }),
});
