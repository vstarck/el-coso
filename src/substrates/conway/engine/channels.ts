import type { ChannelDescriptor } from "@/engine/channels";
import type { ConwayConfig } from "./config";

// Conway has one channel: the per-cell alive flag. Doubled so reads / writes
// don't alias inside the tick loop.
export function buildChannels(config: ConwayConfig): ChannelDescriptor[] {
  return [
    { name: "cells", type: "Uint8Array", size: config.W * config.H, doubled: true },
  ];
}
