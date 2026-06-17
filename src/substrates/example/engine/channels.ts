import type { ChannelDescriptor } from "@/engine/channels";
import type { ExampleConfig } from "./config";

// Declare every typed-array channel the substrate needs. The engine's
// `allocSubstrate` consumes this list to alloc Float32Array / Uint8Array
// buffers, doubled or shared per the `doubled` flag.
//
// The no-op example declares one doubled per-cell counter. Real substrates
// declare all per-agent + per-cell + auxiliary channels here.
export function buildChannels(config: ExampleConfig): ChannelDescriptor[] {
  const F = config.W * config.H;
  return [
    { name: "counter", type: "Float32Array", size: F, doubled: true },
  ];
}
