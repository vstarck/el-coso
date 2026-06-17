/* DVD-screensaver HUD — composite child, top-right toggle panel drawn IN the
 * substrate (not chrome). Owns the four overlay-visibility booleans as its own
 * view-state and exposes them through the standard tunable surface
 * (getTunable(["show", <key>]) / subscribeTunables). Clicks hit-test the
 * toggle rows and flip a flag; the HUD NEVER touches `history` — toggling is a
 * view change, not a substrate input.
 *
 * `composeSimpleSpace` subscribes here and forwards each flag to the matching
 * overlay's `visible` tunable. Siblings never see each other; the scaffold
 * wires them. Toggles are keyed by
 * the overlay's lens id (`["show", "dvd-velocity"]`), which is how the scaffold
 * addresses them — no ordering coupling. */

import { attachCanvasSizing } from "@/lib/canvas/sizing";
import type {
  Lens,
  LensMountArgs,
  MountedLens,
  TunableValue,
  ViewportInset,
} from "@/lenses/types";
import type {
  DvdCommitPayload,
  DvdConfig,
  DvdInputs,
  SubstrateState,
} from "../engine";
import { EVERY_FRAME, PALETTE, PASSIVE_SPEEDS } from "./shared";

// Each toggle is keyed by the overlay lens id it controls — that's how
// `composeSimpleSpace` addresses overlays (`getTunable(["show", overlay.id])`).
// `label` is the short display name; the two are decoupled.
const TOGGLES = [
  { key: "dvd-velocity", label: "velocity", color: PALETTE.velocity },
  { key: "dvd-acceleration", label: "acceleration", color: PALETTE.acceleration },
  { key: "dvd-jitter", label: "jitter", color: PALETTE.jitter },
  { key: "dvd-projection", label: "projection", color: PALETTE.projection },
] as const;
type ToggleKey = (typeof TOGGLES)[number]["key"];

const PAD = 14;
const BOX = 14;
const GAP = 8;
const ROW_H = 24;
const FONT = "13px 'Geist Mono', monospace";

type Rect = { x: number; y: number; w: number; h: number };

function mountHud(
  args: LensMountArgs<SubstrateState, DvdConfig, DvdInputs, DvdCommitPayload>,
): MountedLens<SubstrateState> {
  const { container } = args;
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "auto"; // capture clicks for the toggles
  canvas.setAttribute("aria-label", "lens toggles");
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context on dvd-hud");
  const sizing = attachCanvasSizing(canvas);

  let inset: ViewportInset = { top: 16, right: 16, bottom: 16, left: 16 };
  const unsubscribeViewport = args.subscribeViewport((v) => {
    inset = v;
  });

  const shown: Record<ToggleKey, boolean> = {
    "dvd-velocity": true,
    "dvd-acceleration": true,
    "dvd-jitter": true,
    "dvd-projection": true,
  };
  const listeners = new Set<() => void>();
  function notify(): void {
    for (const cb of listeners) cb();
  }

  // Hit-test rects, recomputed each frame as the HUD lays itself out.
  const rects: Record<ToggleKey, Rect | null> = {
    "dvd-velocity": null,
    "dvd-acceleration": null,
    "dvd-jitter": null,
    "dvd-projection": null,
  };

  function renderFrom(_state: SubstrateState): void {
    const c = ctx!;
    c.clearRect(0, 0, canvas.width, canvas.height);

    const right_x = canvas.width - inset.right - PAD;
    c.font = FONT;
    c.textBaseline = "middle";

    for (let i = 0; i < TOGGLES.length; i++) {
      const tg = TOGGLES[i]!;
      const on = shown[tg.key];
      const cy = inset.top + PAD + i * ROW_H + ROW_H / 2;

      // swatch on the right edge
      const box_x = right_x - BOX;
      const box_y = cy - BOX / 2;
      c.lineWidth = 2;
      c.strokeStyle = tg.color;
      if (on) {
        c.fillStyle = tg.color;
        c.fillRect(box_x, box_y, BOX, BOX);
      } else {
        c.strokeRect(box_x, box_y, BOX, BOX);
      }

      // label to the left of the swatch, right-aligned
      const label_right = box_x - GAP;
      c.textAlign = "right";
      c.fillStyle = on ? PALETTE.hud_text : PALETTE.hud_off;
      c.fillText(tg.label, label_right, cy);

      const tw = c.measureText(tg.label).width;
      const left = label_right - tw - GAP;
      rects[tg.key] = {
        x: left,
        y: cy - ROW_H / 2,
        w: right_x - left,
        h: ROW_H,
      };
    }
  }

  function onClick(e: MouseEvent): void {
    const bounds = canvas.getBoundingClientRect();
    const px = ((e.clientX - bounds.left) * canvas.width) / bounds.width;
    const py = ((e.clientY - bounds.top) * canvas.height) / bounds.height;
    for (const tg of TOGGLES) {
      const r = rects[tg.key];
      if (!r) continue;
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
        shown[tg.key] = !shown[tg.key];
        notify();
        return;
      }
    }
  }
  canvas.addEventListener("click", onClick);

  function getTunable(path: string[]): TunableValue | undefined {
    if (path.length === 2 && path[0] === "show") {
      const key = path[1] as ToggleKey;
      if (key in shown) return String(shown[key]);
    }
    return undefined;
  }
  function setTunable(path: string[], value: TunableValue): void {
    if (path.length === 2 && path[0] === "show") {
      const key = path[1] as ToggleKey;
      if (key in shown) {
        shown[key] = value === "true" || value === true;
        notify();
      }
    }
  }

  return {
    unmount: () => {
      canvas.removeEventListener("click", onClick);
      sizing.detach();
      unsubscribeViewport();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
    renderFrom,
    snapshot: () => canvas,
    commitGlyph: () => ({ kind: "circle" }),
    pause: () => {},
    resume: () => {},
    step: () => {},
    setSpeed: () => {},
    getTunable,
    setTunable,
    subscribeTunables: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const dvdHudLens: Lens<
  SubstrateState,
  DvdConfig,
  DvdInputs,
  DvdCommitPayload
> = {
  id: "dvd-hud",
  name: "Toggles",
  tunables: [],
  speeds: PASSIVE_SPEEDS,
  cadence: EVERY_FRAME,
  target_kind: "canvas2d",
  features: ["SAFE_AREA"],
  mount: mountHud,
};
