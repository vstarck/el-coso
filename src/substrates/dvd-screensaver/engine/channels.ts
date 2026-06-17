import type { ChannelDescriptor } from "@/engine/channels";
import type { DvdConfig } from "./config";

// Eight per-particle Float32Array channels, all doubled (the tick reads the
// previous frame and writes the next). Position + previous-position are the
// stored Verlet dynamics; ax/ay/jx/jy are emitted observables the lenses read.
export function buildChannels(config: DvdConfig): ChannelDescriptor[] {
  const N = config.n;
  return [
    { name: "px", type: "Float32Array", size: N, doubled: true },
    { name: "py", type: "Float32Array", size: N, doubled: true },
    { name: "ppx", type: "Float32Array", size: N, doubled: true },
    { name: "ppy", type: "Float32Array", size: N, doubled: true },
    { name: "ax", type: "Float32Array", size: N, doubled: true },
    { name: "ay", type: "Float32Array", size: N, doubled: true },
    { name: "jx", type: "Float32Array", size: N, doubled: true },
    { name: "jy", type: "Float32Array", size: N, doubled: true },
  ];
}
