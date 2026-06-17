import type { ChannelDescriptor } from "@/engine/channels";
import type { PentrisConfig } from "./config";

// One doubled occupancy channel: the settled stack. The falling piece is
// scalars on the state struct (it's five cells; the channel is the board).
export function buildChannels(config: PentrisConfig): ChannelDescriptor[] {
  const F = config.W * config.H;
  return [{ name: "cells", type: "Uint8Array", size: F, doubled: true }];
}
