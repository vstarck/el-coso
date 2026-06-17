import type { ChannelDescriptor } from "@/engine/channels";
import type { BlockoideConfig } from "./config";

// One doubled occupancy channel: the settled stack + walls. The falling
// piece is scalars on the state struct (it's four cells; the channel is
// the well).
export function buildChannels(config: BlockoideConfig): ChannelDescriptor[] {
  const F = config.W * config.D * config.H;
  return [{ name: "cells", type: "Uint8Array", size: F, doubled: true }];
}
