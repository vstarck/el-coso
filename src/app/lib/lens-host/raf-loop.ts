/* attachRafLoop — the React chrome's binding of the host-agnostic rAF driver
 * (`@/lib/lens-host/raf-loop-core`). It injects the two store touchpoints the
 * core leaves open: the render-rate ceiling (`useStore.fpsCap`) and the rolling
 * fps readout (`useStore.setFps`). The loop semantics — tick/render decoupling,
 * pause-on-unfocus, dt clamp — all live in the core; this file is store glue.
 *
 * Public shape is unchanged (`RafLoopOpts` / `RafLoopHandle`), so the host
 * (`SubstrateHost`) calls it exactly as before.
 */

import { useStore } from "../../store";
import {
  attachRafLoopCore,
  type RafLoopHandle,
} from "@/lib/lens-host/raf-loop-core";

export type { RafLoopHandle };

export type RafLoopOpts = {
  render: () => void;
  tick?: () => void;
  isPlaying?: () => boolean;
  speedMult?: () => number;
};

export function attachRafLoop(opts: RafLoopOpts): RafLoopHandle {
  return attachRafLoopCore({
    ...opts,
    fpsCap: () => useStore.getState().fpsCap,
    reportFps: (fps) => useStore.getState().setFps(fps),
  });
}
