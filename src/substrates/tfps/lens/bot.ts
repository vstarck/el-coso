/* The patrol bot — the self-play "player" (tfps autoplays on load, like the
 * tts / blockoide embeds). It is a pure, deterministic steering function: cast a
 * probe ray straight ahead and two to the sides, walk forward when the way is
 * clear, turn toward the more open side at a wall. Deterministic ⇒ the demo runs
 * the same circuit every load (good for a looping showpiece) and is replayable.
 *
 * It reads the world the same way the renderer does (castRay with unit
 * directions ⇒ euclidean wall distance), so it "sees" exactly what's drawn.
 */

import { castRay } from "./raycast";
import type { TfpsConfig } from "../engine/config";
import type { SubstrateState, TfpsInputs } from "../engine/types";
import { NO_INPUT } from "../engine/types";

const SCAN = 0.5; // probe angle off-center (radians)
const NEAR = 1.3; // start turning when a wall is this close ahead (cells)
const VERY_NEAR = 0.55; // back off if almost touching
const STEER_BIAS = 0.6; // open-space centering sensitivity

function dist(config: TfpsConfig, px: number, py: number, a: number): number {
  return castRay(config, px, py, Math.cos(a), Math.sin(a)).dist;
}

export function botInputs(config: TfpsConfig, s: SubstrateState): TfpsInputs {
  const out: TfpsInputs = { ...NO_INPUT };
  const dFwd = dist(config, s.px, s.py, s.angle);
  const dLeft = dist(config, s.px, s.py, s.angle - SCAN);
  const dRight = dist(config, s.px, s.py, s.angle + SCAN);

  if (dFwd < NEAR) {
    // Wall ahead — pivot toward the more open side (tie breaks right).
    if (dLeft > dRight) out.turnLeft = true;
    else out.turnRight = true;
    if (dFwd < VERY_NEAR) out.back = true; // unstick a nose-in-wall
  } else {
    out.forward = true;
    // Gentle centering so the walker hugs the middle of a corridor.
    if (dLeft - dRight > STEER_BIAS) out.turnLeft = true;
    else if (dRight - dLeft > STEER_BIAS) out.turnRight = true;
  }
  return out;
}
