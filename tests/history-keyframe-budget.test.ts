import { describe, expect, test } from "vitest";

import { createHistory, historyBranchFrom, historyReset, historySetActiveBranch, historyStateAt, historyTick } from "@/history";
import type { HistoryAdapter } from "@/history";
import type { SubstrateBundle } from "@/engine/types";

// The keyframe budget (spec/14 Invariant 9): at most N keyframes per branch, the older part thinned. Keyframes are a
// cache (Invariant 1), so a thinned history must return EXACTLY the states an unthinned one does — on a chaotic map,
// where a replay from the wrong state never re-converges. A fake device counts live snapshots, so a dropped keyframe
// that is not released (or released twice) is an exact-count failure. Each row names what it catches.

class Handle { constructor(readonly id: number) {} }
class FakeDevice {
  private next = 1;
  readonly mem: Record<number, Float64Array> = {};
  create(n: number): Handle { const h = new Handle(this.next++); this.mem[h.id] = new Float64Array(n); return h; }
  destroy(h: Handle): void { if (!(h.id in this.mem)) throw new Error(`double free of buffer ${h.id}`); delete this.mem[h.id]; }
  live(): number { return Object.keys(this.mem).length; }
  bytes(h: Handle): Float64Array { const m = this.mem[h.id]; if (!m) throw new Error(`use after free of buffer ${h.id}`); return m; }
}

const N = 8;
type State = { tick: number; buf: Handle; dev: FakeDevice };
type Input = { push: number };
const bundle: SubstrateBundle<State, { k: number }, Input> = {
  alloc: (_c, r = {}) => { const dev = r.gpu as FakeDevice; return { read: { tick: 0, buf: dev.create(N), dev }, write: { tick: 0, buf: dev.create(N), dev } }; },
  initState: (s) => { const b = s.dev.bytes(s.buf); for (let i = 0; i < N; i++) b[i] = i / N; },
  tick: (read, write, config, rng, input) => {
    const a = read.dev.bytes(read.buf), b = write.dev.bytes(write.buf);
    for (let i = 0; i < N; i++) { const v = a[i]! * config.k + a[(i + 1) % N]! * 0.5 + input.push + rng.seed * 1e-9; b[i] = v - Math.floor(v); }
    write.tick = read.tick + 1;
    return { seed: (Math.imul(rng.seed, 1664525) + 1013904223) >>> 0 };
  },
  snapshot: {
    capture: (s) => { const h = s.dev.create(N); s.dev.bytes(h).set(s.dev.bytes(s.buf)); return { tick: s.tick, buf: h, dev: s.dev }; },
    restore: (t, snap) => { t.dev.bytes(t.buf).set(snap.dev.bytes(snap.buf)); t.tick = snap.tick; },
    release: (snap) => snap.dev.destroy(snap.buf),
  },
  free: (s) => s.dev.destroy(s.buf),
};
const adapter: HistoryAdapter<State, Input, null> = { commit_predicate: () => null, root_commit: () => null };
const inputAt = (t: number): Input => ({ push: (t % 7) * 0.013 });
const make = (budget: number | undefined, period = 10) => {
  const dev = new FakeDevice();
  const h = createHistory({ bundle, config: { k: 3.7 }, rng_seed: 1, adapter, keyframe_period: period, resources: { gpu: dev }, ...(budget !== undefined ? { keyframe_budget: budget } : {}) });
  return { h, dev };
};
const valueOf = (s: State) => Array.from(s.dev.bytes(s.buf));
const ticksOf = (h: ReturnType<typeof make>["h"], b = "main") => h.branches[b]!.keyframes.map((k) => k.tick);

describe("keyframe budget", () => {
  // catches: a budget that is not enforced, or enforced only sometimes
  test("the count never exceeds the budget, and every dropped keyframe is released exactly once", () => {
    for (const budget of [2, 3, 4, 7, 12]) {
      const { h, dev } = make(budget);
      for (let t = 0; t < 600; t++) {
        historyTick(h, inputAt(t));
        expect(h.branches.main!.keyframes.length, `budget ${budget} tick ${t + 1}`).toBeLessThanOrEqual(budget);
        expect(dev.live(), `budget ${budget} tick ${t + 1}`).toBe(2 + h.branches.main!.keyframes.length);
      }
    }
  });

  // catches: thinning that drops the root (replay from nothing on a GPU state) or the newest (recent scrubs slow)
  test("the root keyframe and the newest ceil(budget/2) are always kept", () => {
    const { h } = make(6);
    for (let t = 0; t < 400; t++) {
      historyTick(h, inputAt(t));
      const ks = ticksOf(h);
      expect(ks[0]).toBe(0);
      const head = h.substrate.read.tick, newest: number[] = [];
      for (let k = Math.floor(head / 10) * 10; k > 0 && newest.length < 3; k -= 10) newest.unshift(k);
      for (const k of newest) expect(ks, `tick ${head}`).toContain(k);
    }
  });

  // catches: an order-dependent or wrong-keyframe replay after thinning — the cache must not change any answer
  test("a thinned history returns exactly the states an unthinned one does", () => {
    const thin = make(4), full = make(undefined);
    for (let t = 0; t < 500; t++) { historyTick(thin.h, inputAt(t)); historyTick(full.h, inputAt(t)); }
    expect(ticksOf(thin.h).length).toBeLessThanOrEqual(4);
    expect(ticksOf(full.h).length).toBe(51); // the control: unthinned really keeps all of them
    for (const t of [500, 0, 1, 9, 10, 11, 137, 250, 333, 499, 42]) {
      expect(valueOf(historyStateAt(thin.h, "main", t)), `tick ${t}`).toEqual(valueOf(historyStateAt(full.h, "main", t)));
    }
  });

  // catches: a budget applied to the root branch only, or a fork's keyframes counted against the parent
  test("each branch is budgeted on its own, and its states still match", () => {
    const thin = make(3), full = make(undefined);
    for (const x of [thin, full]) {
      for (let t = 0; t < 200; t++) historyTick(x.h, inputAt(t));
      historyBranchFrom(x.h, "main", 120, "alt");
      historySetActiveBranch(x.h, "alt");
      for (let t = 120; t < 330; t++) historyTick(x.h, inputAt(t + 500));
    }
    expect(ticksOf(thin.h, "alt").length).toBeLessThanOrEqual(3);
    expect(ticksOf(thin.h, "main").length).toBeLessThanOrEqual(3);
    for (const [b, t] of [["alt", 330], ["alt", 125], ["alt", 200], ["main", 199], ["main", 60]] as const) {
      expect(valueOf(historyStateAt(thin.h, b, t)), `${b} ${t}`).toEqual(valueOf(historyStateAt(full.h, b, t)));
    }
    expect(thin.dev.live()).toBe(2 + ticksOf(thin.h, "main").length + ticksOf(thin.h, "alt").length);
  });

  test("a reset keeps the budget and releases everything it drops", () => {
    const { h, dev } = make(4);
    for (let t = 0; t < 300; t++) historyTick(h, inputAt(t));
    historyReset(h);
    expect(dev.live()).toBe(3);
    for (let t = 0; t < 300; t++) historyTick(h, inputAt(t));
    expect(ticksOf(h).length).toBeLessThanOrEqual(4);
  });

  // catches: a budget that silently means something else (0 keyframes; a fraction rounded)
  test("an invalid budget is refused, saying what is allowed", () => {
    for (const b of [0, 1, 1.5, -3, Number.NaN]) {
      expect(() => make(b)).toThrow(/keyframe_budget must be an integer >= 2 or Infinity/);
    }
    expect(() => make(Infinity)).not.toThrow();
  });
});
