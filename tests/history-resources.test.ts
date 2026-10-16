import { describe, expect, test } from "vitest";

import { createHistory, historyBranchFrom, historyReset, historySetActiveBranch, historyStateAt, historyTick, historyTruncate } from "@/history";
import type { HistoryAdapter } from "@/history";
import { runHeadless } from "@/engine";
import type { EngineResources, SubstrateBundle } from "@/engine/types";

// Host resources and snapshot hooks (engine/types.ts). A toy bundle whose State holds a HANDLE into a fake device —
// the shape of a GPU-resident substrate: the bytes are not in the State, the State holds an object that names them,
// and the tick reads one handle's bytes and writes another's. The device counts every live allocation, so a leaked
// keyframe, a double release and a dropped free are all exact-count failures. Each row names what it catches.

class Handle { constructor(readonly id: number) {} }
class FakeDevice {
  private next = 1;
  readonly mem: Record<number, Float64Array> = {};
  create(n: number): Handle { const h = new Handle(this.next++); this.mem[h.id] = new Float64Array(n); return h; }
  destroy(h: Handle): void {
    if (!(h.id in this.mem)) throw new Error(`double free of buffer ${h.id}`);
    delete this.mem[h.id];
  }
  live(): number { return Object.keys(this.mem).length; }
  bytes(h: Handle): Float64Array {
    const m = this.mem[h.id];
    if (!m) throw new Error(`use after free of buffer ${h.id}`);
    return m;
  }
}

const N = 16;
type State = { tick: number; buf: Handle; dev: FakeDevice };
type Config = { k: number };
type Input = { push: number };

function makeBundle(opts: { hooks: boolean; requires?: boolean }) {
  const allocs: EngineResources[] = [];
  const bundle: SubstrateBundle<State, Config, Input> = {
    alloc: (_config, resources = {}) => {
      allocs.push(resources);
      const dev = resources.gpu as FakeDevice;
      return { read: { tick: 0, buf: dev.create(N), dev }, write: { tick: 0, buf: dev.create(N), dev } };
    },
    initState: (s) => { const b = s.dev.bytes(s.buf); for (let i = 0; i < N; i++) b[i] = i / N; },
    // Path-dependent and chaotic, so a tick replayed from a wrong state never re-converges.
    tick: (read, write, config, rng, input) => {
      const a = read.dev.bytes(read.buf), b = write.dev.bytes(write.buf);
      for (let i = 0; i < N; i++) { const v = a[i]! * config.k + a[(i + 1) % N]! * 0.5 + input.push + rng.seed * 1e-9; b[i] = v - Math.floor(v); }
      write.tick = read.tick + 1;
      return { seed: (Math.imul(rng.seed, 1664525) + 1013904223) >>> 0 };
    },
  };
  if (opts.requires) bundle.requires = ["gpu"];
  if (opts.hooks) {
    bundle.snapshot = {
      capture: (s) => { const h = s.dev.create(N); s.dev.bytes(h).set(s.dev.bytes(s.buf)); return { tick: s.tick, buf: h, dev: s.dev }; },
      restore: (t, snap) => { t.dev.bytes(t.buf).set(snap.dev.bytes(snap.buf)); t.tick = snap.tick; },
      release: (snap) => snap.dev.destroy(snap.buf),
    };
    bundle.free = (s) => s.dev.destroy(s.buf);
  }
  return { bundle, allocs };
}

const adapter: HistoryAdapter<State, Input, null> = { commit_predicate: () => null, root_commit: () => null };
const inputAt = (t: number): Input => ({ push: (t % 7) * 0.013 });
const make = (dev: FakeDevice, opts = { hooks: true }, period = 50) => {
  const { bundle, allocs } = makeBundle(opts);
  return { h: createHistory({ bundle, config: { k: 3.7 }, rng_seed: 1, adapter, keyframe_period: period, resources: { gpu: dev } }), allocs };
};
const valueOf = (s: State) => Array.from(s.dev.bytes(s.buf));

describe("the generic keyframe copy refuses what it cannot copy", () => {
  // catches: the old cloneField, which turned a class instance into {} with no error
  test("a handle in State, no hooks → createHistory throws, naming the field and the type", () => {
    expect(() => make(new FakeDevice(), { hooks: false })).toThrow(/state field "buf" holds a Handle, which the generic keyframe copy cannot snapshot/);
  });
  test("the path names a non-plain object nested inside an array", () => {
    const bundle: SubstrateBundle<{ tick: number; list: unknown[] }, Config, Input> = {
      alloc: () => ({ read: { tick: 0, list: [{ a: 1 }, new Handle(9)] }, write: { tick: 0, list: [] } }),
      initState: () => {},
      tick: (_r, w, _c, rng) => { w.tick += 1; return rng; },
    };
    expect(() => createHistory({ bundle, config: { k: 1 }, rng_seed: 1, adapter: { commit_predicate: () => null, root_commit: () => null } }))
      .toThrow(/state field "list\[1\]" holds a Handle/);
  });
  // the control: plain data, arrays, nested plain objects and typed arrays still snapshot (the rest of the suite is
  // the wider control — every existing substrate keyframes through this path)
  test("plain objects, arrays and typed arrays still copy", () => {
    const bundle: SubstrateBundle<{ tick: number; o: { a: number[]; t: Float32Array }; n: null }, Config, Input> = {
      alloc: () => ({ read: { tick: 0, o: { a: [1, 2], t: new Float32Array(2) }, n: null }, write: { tick: 0, o: { a: [], t: new Float32Array(2) }, n: null } }),
      initState: () => {},
      tick: (r, w, _c, rng) => { w.tick = r.tick + 1; w.o = { a: [...r.o.a, r.tick], t: new Float32Array(r.o.t) }; return rng; },
    };
    const h = createHistory({ bundle, config: { k: 1 }, rng_seed: 1, adapter: { commit_predicate: () => null, root_commit: () => null }, keyframe_period: 2 });
    for (let i = 0; i < 5; i++) historyTick(h, { push: 0 });
    expect(historyStateAt(h, "main", 2).o.a).toEqual([1, 2, 0, 1]);
  });
});

describe("requires — a bundle is refused, with the cause, when the host did not provide a resource", () => {
  // catches: an alloc that runs without its device and fails later for a cause nobody named
  test("absent, no reason", () => {
    const { bundle } = makeBundle({ hooks: true, requires: true });
    expect(() => createHistory({ bundle, config: { k: 1 }, rng_seed: 1, adapter })).toThrow(/requires the "gpu" resource and the host provided none \(no reason given\)/);
  });
  test("absent, with the host's reason", () => {
    const { bundle } = makeBundle({ hooks: true, requires: true });
    expect(() => createHistory({ bundle, config: { k: 1 }, rng_seed: 1, adapter, resources: { unavailable: { gpu: "no adapter" } } }))
      .toThrow(/requires the "gpu" resource and the host provided none \(no adapter\)/);
  });
  test("runHeadless refuses the same way, and passes the resource when given", () => {
    const { bundle, allocs } = makeBundle({ hooks: true, requires: true });
    expect(() => runHeadless(bundle, { k: 3.7 }, 1, [inputAt(0)])).toThrow(/requires the "gpu" resource/);
    const dev = new FakeDevice();
    const s = runHeadless(bundle, { k: 3.7 }, 1, [inputAt(0), inputAt(1)], { gpu: dev });
    expect(s.tick).toBe(2);
    expect(allocs.at(-1)!.gpu).toBe(dev);
  });
  // catches: a reset (or any re-alloc) that forgets the resources the history was built with
  test("a reset re-allocs on the SAME resources", () => {
    const dev = new FakeDevice();
    const { h, allocs } = make(dev);
    historyTick(h, inputAt(0));
    historyReset(h);
    expect(allocs).toHaveLength(2);
    expect(allocs[1]!.gpu).toBe(dev);
  });
});

describe("snapshot hooks — keyframes the history cannot copy itself", () => {
  // catches: a restore that does not reach the device (the scrub shows the head), a keyframe captured by reference
  // (the scrub shows a later state), and any replay from the wrong keyframe — exact values on a chaotic map
  test("every scrubbed tick equals the straight run, exactly", () => {
    const dev = new FakeDevice();
    const { h } = make(dev);
    const straight: number[][] = [valueOf(h.substrate.read)];
    for (let t = 0; t < 250; t++) { historyTick(h, inputAt(t)); straight.push(valueOf(h.substrate.read)); }
    // non-degeneracy: the map moves, so equality is not satisfied by a dead tick
    expect(straight[37]).not.toEqual(straight[38]);
    for (const t of [249, 0, 37, 50, 51, 120, 200, 3, 250]) expect(valueOf(historyStateAt(h, "main", t)), `tick ${t}`).toEqual(straight[t]);
  });

  // catches: a keyframe dropped without release (a leak), a release of a kept one (use-after-free on the next scrub)
  // and a free skipped on reset — the device's live count is exact at every step
  test("truncate, cascade and reset release exactly what they drop", () => {
    const dev = new FakeDevice();
    const { h } = make(dev);
    expect(dev.live()).toBe(3); // read + write + the root keyframe
    for (let t = 0; t < 230; t++) historyTick(h, inputAt(t));
    expect(dev.live()).toBe(2 + 5); // keyframes at 0, 50, 100, 150, 200
    historyBranchFrom(h, "main", 160, "alt");
    historySetActiveBranch(h, "alt");
    for (let t = 160; t < 260; t++) historyTick(h, inputAt(t + 1000)); // keyframes at 200, 250 on "alt"
    expect(dev.live()).toBe(2 + 7);
    historySetActiveBranch(h, "main");
    historyTruncate(h, "main", 120); // drops main's 150, 200 and cascades "alt" (forked at 160) with its two
    expect(h.branches.alt).toBeUndefined();
    expect(dev.live()).toBe(2 + 3); // 0, 50, 100
    expect(valueOf(historyStateAt(h, "main", 110)).length).toBe(N); // the kept keyframes still resolve
    historyReset(h); // releases the three, frees both halves, allocs fresh and keyframes the root
    expect(dev.live()).toBe(3);
  });
});
