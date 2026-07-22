export type {
  Resolve,
  ResolveOpts,
  ResolutionKind,
  ResolutionRecord,
  RNGState,
  Substrate,
  SubstrateBundle,
} from "./types";

export type { ChannelBag, ChannelDescriptor } from "./channels";
export { allocChannels, channelAlloc } from "./channels";

export { allocSubstrate, swap, tick, tickAny, tickReplay } from "./substrate";
export { runHeadless } from "./headless";
export { nextNormal, nextRange, nextUniform } from "./rng";
export {
  makeEntropyResolve,
  makeRecordResolve,
  makeRngResolve,
  makeTag,
  makeVerifyResolve,
  parseTag,
  resolveDraw,
} from "./resolver";

export type { Mailbox, Schedulable, Scheduler } from "./kit/scheduler";
export { makeMailbox, makeScheduler } from "./kit/scheduler";
