/* Element-scoped keyboard → held movement inputs.
 *
 * Listeners attach to the focusable CRT screen (not window), so several embeds
 * on one page never trade keystrokes — same isolation as tts. Keys are ARROWS
 * (+ `,` / `.` for strafe) only: the terminal command line consumes letters and
 * digits into its buffer, so movement deliberately avoids WASD to stay out of
 * its way (the same resolution tts reached). Held state is read by `drain()`
 * each tick; the first movement key fires `onIntent` so the lens can hand
 * control from the autopilot to the player.
 */

import type { TfpsInputs } from "../engine/types";

const KEY_MAP: Record<string, keyof TfpsInputs> = {
  ArrowUp: "forward",
  ArrowDown: "back",
  ArrowLeft: "turnLeft",
  ArrowRight: "turnRight",
  ",": "strafeLeft",
  ".": "strafeRight",
};

export type PlayerInput = {
  drain(): TfpsInputs;
  detach(): void;
};

export function attachInput(
  target: HTMLElement,
  onIntent: () => void,
): PlayerInput {
  const held = new Set<keyof TfpsInputs>();

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = KEY_MAP[e.key];
    if (!action) return;
    held.add(action);
    onIntent();
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onKeyUp(e: KeyboardEvent): void {
    const action = KEY_MAP[e.key];
    if (action) held.delete(action);
  }

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);

  return {
    drain(): TfpsInputs {
      return {
        forward: held.has("forward"),
        back: held.has("back"),
        turnLeft: held.has("turnLeft"),
        turnRight: held.has("turnRight"),
        strafeLeft: held.has("strafeLeft"),
        strafeRight: held.has("strafeRight"),
      };
    },
    detach(): void {
      target.removeEventListener("keydown", onKeyDown, true);
      target.removeEventListener("keyup", onKeyUp, true);
      held.clear();
    },
  };
}
