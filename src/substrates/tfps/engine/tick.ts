import type { RNGState } from "@/engine/types";
import { isWall, type TfpsConfig } from "./config";
import type { SubstrateState, TfpsInputs } from "./types";

// Collision radius: the camera is treated as a small disc so it can't graze
// into a wall cell. Kept well under 0.5 so a 1-wide corridor stays passable.
const RADIUS = 0.2;

// Move along (dx, dy) with per-axis wall sliding: each axis advances only if the
// destination (offset by the collision radius in the direction of travel) is
// clear, so a diagonal into a wall slides along it instead of sticking. Returns
// the resolved position.
export function tryMove(
  config: TfpsConfig,
  px: number,
  py: number,
  dx: number,
  dy: number,
): { px: number; py: number } {
  let rx = px;
  let ry = py;
  const nx = rx + dx;
  if (!isWall(config, nx + Math.sign(dx) * RADIUS, ry)) rx = nx;
  const ny = ry + dy;
  if (!isWall(config, rx, ny + Math.sign(dy) * RADIUS)) ry = ny;
  return { px: rx, py: ry };
}

// One tick: rotate by the turn inputs, then translate by forward/back + strafe
// along the new facing, resolving collisions. No RNG is consumed — locomotion is
// fully deterministic from (pose, inputs).
export function tickTfps(
  r: SubstrateState,
  w: SubstrateState,
  config: TfpsConfig,
  rng: RNGState,
  inputs: TfpsInputs,
): RNGState {
  w.tick = r.tick + 1;

  const turn =
    (inputs.turnRight ? 1 : 0) - (inputs.turnLeft ? 1 : 0);
  const angle = r.angle + turn * config.turnSpeed;

  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // "Right" of facing (clockwise 90°, y-down): (-dirY, dirX).
  const rightX = -dirY;
  const rightY = dirX;

  const fwd = (inputs.forward ? 1 : 0) - (inputs.back ? 1 : 0);
  const str = (inputs.strafeRight ? 1 : 0) - (inputs.strafeLeft ? 1 : 0);
  const speed = config.moveSpeed;

  const dx = (dirX * fwd + rightX * str) * speed;
  const dy = (dirY * fwd + rightY * str) * speed;

  const moved = tryMove(config, r.px, r.py, dx, dy);
  w.px = moved.px;
  w.py = moved.py;
  w.angle = angle;

  return rng;
}
