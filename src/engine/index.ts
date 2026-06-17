export type {
  RNGState,
  Substrate,
  SubstrateBundle,
} from "./types";

export type { ChannelBag, ChannelDescriptor } from "./channels";
export { allocChannels, channelAlloc } from "./channels";

export { allocSubstrate, swap, tick } from "./substrate";
export { runHeadless } from "./headless";
export { nextNormal, nextRange, nextUniform } from "./rng";
