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
import { frameProfilerFromEnv } from "@/lib/lens-host/frame-profiler";

export type { RafLoopHandle };

export type RafLoopOpts = {
  render: () => void;
  tick?: () => void;
  isPlaying?: () => boolean;
  speedMult?: () => number;
  /** Substrate/lens id for the dev frame-profiler's over-budget warnings. The
   *  profiler is off (zero overhead) unless the runtime gate (`?profile`) is
   *  set. */
  label?: string;
};

export function attachRafLoop(opts: RafLoopOpts): RafLoopHandle {
  const { label, ...loop } = opts;
  const profiler = frameProfilerFromEnv(label);
  return attachRafLoopCore({
    ...loop,
    fpsCap: () => useStore.getState().fpsCap,
    reportFps: (stats) => useStore.getState().setFps(stats),
    ...(profiler ? { profile: profiler.profile } : {}),
  });
}
