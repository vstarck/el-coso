import type { ChannelDescriptor } from "@/engine/channels";
import type { TronConfig } from "./config";

// One doubled per-cell occupancy channel. The trail only grows (classic
// Tron — no decay), but it's a hot W*H grid read every tick, so it lives
// in a channel rather than a plain array (Q3 dense / hot-path).
export function buildChannels(config: TronConfig): ChannelDescriptor[] {
  const F = config.W * config.H;
  return [
    { name: "cells", type: "Uint8Array", size: F, doubled: true },
  ];
}
