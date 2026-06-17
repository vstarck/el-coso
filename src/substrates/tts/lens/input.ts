/* tts player input — the keyboard half of the lens's Q4 agency: held
 * left/right move + tap-buffered rotate/drop, scoped to a single focusable
 * element so several embeds on one page don't trade keystrokes.
 *
 * Gameplay is arrows + Space ONLY — every letter belongs to the terminal's
 * command line, so typing a command never moves a piece. Listeners are
 * capture-phase + preventDefault so the arrows/Space are the game's while
 * mounted (Space would otherwise scroll the page / toggle chrome play).
 */

import type { TtsInputs } from "../engine";

const KEYS: Record<"left" | "right" | "rotate" | "drop", string[]> = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  rotate: ["ArrowUp"],
  drop: ["ArrowDown", " ", "Spacebar"],
};

export type PlayerInput = {
  // Read-and-clear one tick of input: held move direction + a single buffered
  // rotate/drop tap (taps queue up to 2 so a fast double-tap isn't dropped).
  drain(): TtsInputs;
  // Remove the listeners.
  detach(): void;
};

// Attach element-scoped keyboard input to `target` (the focusable CRT screen).
export function attachInput(target: HTMLElement): PlayerInput {
  const held = { left: false, right: false };
  let tap_rotate = 0;
  let tap_drop = 0;

  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) return; // chords belong to the host
    const k = e.key;
    if (KEYS.left.includes(k)) held.left = true;
    else if (KEYS.right.includes(k)) held.right = true;
    else if (KEYS.rotate.includes(k) && !e.repeat) {
      if (tap_rotate < 2) tap_rotate += 1;
    } else if (KEYS.drop.includes(k) && !e.repeat) {
      if (tap_drop < 2) tap_drop += 1;
    } else return;
    e.preventDefault();
  }
  function onKeyUp(e: KeyboardEvent): void {
    const k = e.key;
    if (KEYS.left.includes(k)) held.left = false;
    else if (KEYS.right.includes(k)) held.right = false;
  }
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);

  return {
    drain(): TtsInputs {
      const rotate = tap_rotate > 0 ? 1 : 0;
      if (tap_rotate > 0) tap_rotate -= 1;
      const drop = tap_drop > 0;
      if (tap_drop > 0) tap_drop -= 1;
      return {
        move: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        rotate,
        drop,
      };
    },
    detach(): void {
      target.removeEventListener("keydown", onKeyDown, true);
      target.removeEventListener("keyup", onKeyUp, true);
    },
  };
}
