// Channel helper — optional SoA allocation strategy for substrates whose
// State is performance-critical (hot-path tick, many entities, mutate in
// place). The engine itself doesn't require channels; this module is what a
// bundle's `alloc` function reaches for when it wants pre-allocated typed
// arrays + read/write doubling.
//
// Substrates that are sparse, event-driven, or otherwise GC-tolerant
// (e.g. a turn-based board) can skip this module entirely and
// implement `bundle.alloc` directly with plain objects.

// Declarative description of one typed-array channel the substrate needs.
// The bundle's `buildChannels` produces a descriptor list; `channelAlloc`
// turns it into the read/write State pair the engine consumes.
export type ChannelDescriptor = {
  name: string;                              // matches a key on the substrate's State shape
  type: "Float32Array" | "Uint8Array";
  size: number;                              // element count (substrate decides agents vs field vs other)
  doubled: boolean;                          // false → shared reference across read/write
};

// Untyped channel bag. The substrate's `wire` callback maps named entries
// into its typed State struct.
export type ChannelBag = Record<string, Float32Array | Uint8Array>;

// Allocate read/write channel bags from a descriptor list. Doubled
// channels get two distinct arrays; undoubled channels share one.
export function allocChannels(
  descriptors: ChannelDescriptor[],
): { read: ChannelBag; write: ChannelBag } {
  const read: ChannelBag = {};
  const write: ChannelBag = {};
  for (const desc of descriptors) {
    if (desc.doubled) {
      read[desc.name] = allocOne(desc.type, desc.size);
      write[desc.name] = allocOne(desc.type, desc.size);
    } else {
      const shared = allocOne(desc.type, desc.size);
      read[desc.name] = shared;
      write[desc.name] = shared;
    }
  }
  return { read, write };
}

function allocOne(
  type: "Float32Array" | "Uint8Array",
  size: number,
): Float32Array | Uint8Array {
  return type === "Float32Array"
    ? new Float32Array(size)
    : new Uint8Array(size);
}

// Compose a `Bundle.alloc` function from a substrate's channel-descriptor
// builder + State-wiring callback. The substrate's bundle becomes:
//
//   export const fooBundle: SubstrateBundle<State, Config, Inputs> = {
//     alloc: channelAlloc(buildChannels, makeState),
//     initState,
//     tick: tickFoo,
//   };
export function channelAlloc<State, Config>(
  buildChannels: (config: Config) => ChannelDescriptor[],
  wire: (bag: ChannelBag, config: Config) => State,
): (config: Config) => { read: State; write: State } {
  return (config) => {
    const descriptors = buildChannels(config);
    const bags = allocChannels(descriptors);
    return {
      read: wire(bags.read, config),
      write: wire(bags.write, config),
    };
  };
}
