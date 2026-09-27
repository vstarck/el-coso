import { describe, expect, test } from "vitest";

import {
  createHistory,
  historyActiveBranch,
  historyAdvance,
  historyBranchFrom,
  historyEditConfig,
  historyReset,
  historySetActiveBranch,
  historyStateAt,
  historyTick,
  historyTruncate,
  tapeApply,
  tapeDiff,
  tapeRestore,
  tapeSetPath,
  tapeShare,
  type History,
  type HistoryAdapter,
} from "@/history";
import type { SubstrateBundle } from "@/engine/types";

// spec/31 — the config tape. A toy substrate whose tick READS the config every tick, in a path-dependent way, so a
// tick replayed under the wrong config leaves a different state behind for ever after. Edits go through the explicit
// API, `historyEditConfig` (S235: a per-tick diff measured 16 ms/tick on rele and 28 ms on tilin). Each row names the
// sabotage it exists to catch (spec/31 §6); the canaries were run against exactly those (dev/canary-config-tape.py).

type TapeConfig = {
  k: number;
  nested: { a: number; arr: number[] };
  img: Uint8Array;
  extra?: string;
};
type TapeState = { tick: number; acc: number; lastK: number; lastA: number; px: number };
type Payload = { tick: number; acc: number };

const makeState = (): TapeState => ({ tick: 0, acc: 0, lastK: 0, lastA: 0, px: 0 });

const bundle: SubstrateBundle<TapeState, TapeConfig, Record<string, never>> = {
  alloc: () => ({ read: makeState(), write: makeState() }),
  initState: () => {},
  tick: (r, w, config, rng) => {
    w.tick = r.tick + 1;
    // path-dependent: every later acc depends on every earlier config
    w.acc = r.acc * 0.75 + config.k * w.tick + config.nested.a + config.nested.arr.length + config.img[0]!;
    w.lastK = config.k;
    w.lastA = config.nested.a;
    w.px = config.img[0]!;
    return rng;
  },
};

// a commit every 5 ticks, carrying acc: the timeline's claim about what ran
const adapter: HistoryAdapter<TapeState, Record<string, never>, Payload> = {
  root_commit: (s) => ({ tick: s.tick, acc: s.acc }),
  commit_predicate: (_b, a) => (a.tick % 5 === 0 ? { tick: a.tick, acc: a.acc } : null),
};

const makeConfig = (): TapeConfig => ({ k: 1, nested: { a: 0, arr: [1, 2, 3] }, img: new Uint8Array([7, 8, 9, 10]) });
type H = History<TapeState, TapeConfig, Record<string, never>, Payload>;
const make = (keyframe_period: number, config_verify = true): H =>
  createHistory({ bundle, config: makeConfig(), rng_seed: 1, adapter, keyframe_period, config_verify });
type P = (string | number)[];
const edit = (h: H, path: P, value: unknown): void => historyEditConfig(h, path, value);

const snap = (s: TapeState): string => JSON.stringify(s);
const cfgSnap = (c: TapeConfig): string => JSON.stringify({ ...c, img: Array.from(c.img) });

/** the edit script shared by several rows: tick → edits made through the API just BEFORE that tick runs */
const EDITS: Record<number, (h: H) => void> = {
  13: (h) => { edit(h, ["k"], 2); },
  29: (h) => { edit(h, ["k"], 5); edit(h, ["k"], 3); }, // two edits between ticks: the later wins
  30: (h) => { edit(h, ["k"], 3); }, // a same-value edit
  41: (h) => { edit(h, ["nested", "a"], 4); },
  55: (h) => { edit(h, ["nested", "arr"], [1, 2, 3, 4]); },
  60: (h) => { edit(h, ["img", 0], 99); },
  66: (h) => { edit(h, ["extra"], "added"); },
  71: (h) => { edit(h, ["extra"], undefined); edit(h, ["k"], 1); }, // undefined deletes the key
};
const HEAD = 80;

/** run to HEAD applying EDITS, recording the live state and config at every tick */
function runScripted(h: H): { states: string[]; configs: string[] } {
  const states = [snap(h.substrate.read)], configs = [cfgSnap(h.config)];
  for (let t = 1; t <= HEAD; t++) {
    EDITS[t]?.(h);
    historyTick(h, {});
    states.push(snap(h.substrate.read));
    configs.push(cfgSnap(h.config));
  }
  return { states, configs };
}

describe("spec/31 — the config tape", () => {
  test("1 · the CR1 world: after live edits, every tick rewinds to the state that RAN, and each commit agrees with its scrub", () => {
    const h = make(20);
    const live = runScripted(h);
    // non-degeneracy: the edits changed the trajectory (else an exact replay proves nothing)
    const control = make(20);
    for (let t = 1; t <= HEAD; t++) historyTick(control, {});
    expect(snap(control.substrate.read)).not.toBe(live.states[HEAD]);
    // scrub in a scrambled order, twice
    const order = Array.from({ length: HEAD + 1 }, (_, t) => (t * 37) % (HEAD + 1));
    for (const pass of [0, 1]) {
      for (const t of order) {
        const s = historyStateAt(h, "main", t);
        expect(snap(s), `pass ${pass}, tick ${t}: state`).toBe(live.states[t]);
        expect(cfgSnap(h.config), `pass ${pass}, tick ${t}: config at the playhead`).toBe(live.configs[t]);
      }
    }
    for (const c of historyActiveBranch(h).commits) {
      if (c.tick === 0) continue;
      historyStateAt(h, "main", c.tick);
      expect(c.payload.acc, `commit at ${c.tick}`).toBe(h.substrate.read.acc);
    }
  });

  test("2 · spec/14 Invariant 1 under edits: keyframe period ∞ and 7 give identical states AND configs at every tick", () => {
    const a = make(Infinity), b = make(7);
    runScripted(a);
    runScripted(b);
    for (let t = HEAD; t >= 0; t -= 3) {
      expect(snap(historyStateAt(a, "main", t)), `tick ${t}`).toBe(snap(historyStateAt(b, "main", t)));
      expect(cfgSnap(a.config), `tick ${t}`).toBe(cfgSnap(b.config));
    }
  });

  test("3 · h.config keeps its identity (and its nested objects' identities) across scrubs, replays, branches and resets", () => {
    const h = make(10);
    const config = h.config, nested = h.config.nested, arr = h.config.nested.arr, img = h.config.img;
    runScripted(h);
    historyStateAt(h, "main", 3);
    historyStateAt(h, "main", 77);
    historyBranchFrom(h, "main", 40, "b");
    historySetActiveBranch(h, "b");
    historySetActiveBranch(h, "main");
    historyTruncate(h, "main", 50);
    historyReset(h);
    expect(h.config).toBe(config);
    expect(h.config.nested).toBe(nested);
    expect(h.config.nested.arr).toBe(arr);
    expect(h.config.img).toBe(img);
  });

  test("4 · branches diverge in config; switching branch restores that branch's config; truncation drops later edits", () => {
    // period ∞: every restore replays ENTRIES from the root. At period 10 each check landed on a keyframe or on a
    // segment with no edit after its keyframe, so the row never read replay's entry restore (canary C1, S235).
    const h = make(Infinity);
    runScripted(h);
    const mainHead = { s: snap(h.substrate.read), c: cfgSnap(h.config) };
    historyBranchFrom(h, "main", 20, "b");
    historySetActiveBranch(h, "b");
    expect(h.config.k).toBe(2); // the config in effect at tick 20 (edit at 13)
    edit(h, ["k"], 9);
    for (let t = 21; t <= 40; t++) historyTick(h, {});
    const bHead = { s: snap(h.substrate.read), c: cfgSnap(h.config) };
    expect(bHead.c).not.toBe(mainHead.c);
    historySetActiveBranch(h, "main");
    expect(snap(h.substrate.read)).toBe(mainHead.s);
    expect(cfgSnap(h.config)).toBe(mainHead.c);
    historySetActiveBranch(h, "b");
    expect(snap(h.substrate.read)).toBe(bHead.s);
    expect(cfgSnap(h.config)).toBe(bHead.c);
    // on the branch, its fork tick is main's past, under main's config (a tick before the fork is refused by the engine)
    historyStateAt(h, "b", 20);
    expect(h.config.k).toBe(2);
    historySetActiveBranch(h, "main");
    historyTruncate(h, "main", 25);
    expect(h.config.k).toBe(2); // the edits at 29+ are gone
    historyTick(h, {});
    expect(h.substrate.read.lastK).toBe(2);
  });

  test("5 · an edit is never destroyed by a restore: behind the head it is not written into the past; it lands at the head as a PATCH", () => {
    const h = make(10);
    runScripted(h); // head 80: k 1, nested.a 4 (edits at 13…71)
    const inputsBefore = JSON.stringify(historyActiveBranch(h).inputs);
    // (a) scrub back to 20 (k 2, a 0), edit a DIFFERENT key there, scrub on
    historyStateAt(h, "main", 20);
    edit(h, ["nested", "a"], 7);
    expect(h.config.nested.a, "behind the head an edit is not written into the past").toBe(0);
    historyStateAt(h, "main", 35);
    expect(h.config.nested.a).toBe(0); // behind the head, the tape wins
    expect(h.config.k).toBe(3);
    expect(JSON.stringify(historyActiveBranch(h).inputs)).toBe(inputsBefore); // nothing recorded in the past
    // (b) the next tick re-anchors to the head and applies ONLY the edited leaf: k stays the head's 1, not tick 20's 2
    historyTick(h, {});
    expect(h.substrate.read.tick).toBe(HEAD + 1);
    expect(h.substrate.read.lastA).toBe(7);
    expect(h.substrate.read.lastK).toBe(1);
    expect(h.config.nested.a).toBe(7);
    expect(historyActiveBranch(h).inputs.at(-1)!.config).toBeDefined();
    // (c) an edit AT the head (written at once), then a scrub before any tick: it survives too
    edit(h, ["k"], 6);
    expect(h.config.k).toBe(6);
    historyStateAt(h, "main", 10);
    expect(h.config.k).toBe(1); // tick 10 is before the edit at 13
    historyTick(h, {});
    expect(h.substrate.read.lastK).toBe(6);
  });

  test("6 · beyond the head, historyAdvance leaves a per-tick config write alone (the log-less loop: una-wacha, faro, …)", () => {
    const h = make(10);
    for (let i = 1; i <= 30; i++) {
      h.config.k = i * 2; // a write every tick, never recorded (the substrate keeps no log)
      historyAdvance(h, {});
      expect(h.substrate.read.lastK, `advance ${i}`).toBe(i * 2);
    }
    expect(historyActiveBranch(h).head_tick).toBe(0);
  });

  test("7 · behind the head, historyAdvance with a caller-built input still replays the logged config", () => {
    const h = make(10);
    const live = runScripted(h);
    historyStateAt(h, "main", 5);
    for (let t = 6; t <= HEAD; t++) {
      historyAdvance(h, {}); // the ~30 lenses pass their own input, not the log entry
      expect(snap(h.substrate.read), `tick ${t}`).toBe(live.states[t]);
    }
  });

  test("8 · structural sharing: an edit's snapshot shares every subtree off its path with the previous one", () => {
    const h = make(10);
    const t0 = h.config_tape;
    historyTick(h, {});
    expect(h.config_tape).toBe(t0); // no edit, no new snapshot
    edit(h, ["k"], 4);
    historyTick(h, {});
    const t1 = h.config_tape;
    expect(t1).not.toBe(t0);
    expect(t1.nested).toBe(t0.nested);
    expect(t1.img).toBe(t0.img);
    edit(h, ["nested", "a"], 1);
    historyTick(h, {});
    expect(h.config_tape.nested).not.toBe(t1.nested);
    expect(h.config_tape.nested.arr).toBe(t1.nested.arr);
    expect(h.config_tape.img).toBe(t1.img);
  });

  test("9 · tapeShare / tapeRestore / tapeDiff / tapeApply round-trip typed arrays, nested arrays, keys, −0 and NaN", () => {
    type X = Record<string, unknown>;
    const base: X = { z: 0, n: NaN, m: [[1, 2], [3]], f: new Float32Array([1, 2]), i: new Int32Array([5]), o: { p: 1, q: [1] } };
    const s0 = tapeShare(base, undefined) as X;
    expect(tapeShare(base, s0)).toBe(s0); // NaN equals NaN here (Object.is)
    const live: X = { z: -0, n: NaN, m: [[1, 2], [3, 4]], f: new Float32Array([1, 3]), i: new Int32Array([5]), o: { p: 1, q: [1] }, add: "x" };
    const s1 = tapeShare(live, s0) as X;
    expect(s1).not.toBe(s0);
    expect(Object.is(s1.z, -0)).toBe(true); // −0 is a change
    expect(s1.i).toBe(s0.i);
    expect(s1.o).toBe(s0.o);
    expect(s1.f).toBeInstanceOf(Float32Array);
    expect(s1.f).not.toBe(live.f); // a snapshot never aliases the live config
    // restore s0 into live, in place
    const f = live.f, m = live.m;
    tapeRestore(live, s0);
    expect(live.f).toBe(f);
    expect(live.m).toBe(m);
    expect(Array.from(live.f as Float32Array)).toEqual([1, 2]);
    expect(live.m).toEqual([[1, 2], [3]]);
    expect("add" in live).toBe(false);
    expect(Object.is(live.z, 0)).toBe(true);
    // a mismatched typed array (other subtype or length) is replaced by a copy, not .set() into
    const g: X = { f: new Float64Array([1, 2, 3]) };
    tapeRestore(g, { f: new Float32Array([4]) });
    expect(g.f).toBeInstanceOf(Float32Array);
    expect(Array.from(g.f as Float32Array)).toEqual([4]);
    // diff + apply: the leaves only
    const a: X = { k: 1, o: { p: 1, q: [1, 2] }, gone: 1 };
    const b: X = { k: 1, o: { p: 2, q: [1, 2] }, new: [3] };
    const patch = tapeDiff(b, a);
    const target: X = { k: 9, o: { p: 1, q: [1, 2] }, gone: 1 };
    tapeApply(target, patch);
    expect(target).toEqual({ k: 9, o: { p: 2, q: [1, 2] }, new: [3] });
    // tapeSetPath: copy-on-write along the path only
    const t0: X = { a: { b: [1, 2], c: { d: 1 } }, e: new Int32Array([1]) };
    const t1 = tapeSetPath(t0, ["a", "b", 1], 5) as X;
    expect(t1).not.toBe(t0);
    expect((t1.a as X).c).toBe((t0.a as X).c);
    expect(t1.e).toBe(t0.e);
    expect((t1.a as X).b).toEqual([1, 5]);
    expect((t0.a as X).b).toEqual([1, 2]); // the old snapshot untouched
    expect("e" in (tapeSetPath(t0, ["e"], undefined) as X)).toBe(false);
  });

  test("10 · a run with no edit records no config; a write that bypasses the API is refused by the guard, naming its path", () => {
    const h = make(10);
    for (let t = 1; t <= 40; t++) historyTick(h, {});
    expect(historyActiveBranch(h).inputs.filter((e) => e.config !== undefined)).toHaveLength(0);
    h.config.nested.a = 3; // a channel nobody ported
    expect(() => historyTick(h, {})).toThrow(/config written without historyEditConfig.*nested\.a/);
    // without the guard the write is NOT recorded: today's behaviour for an unported channel (spec/31 §2)
    const g = make(10, false);
    g.config.k = 8;
    historyTick(g, {});
    expect(g.substrate.read.lastK).toBe(8);
    expect(historyActiveBranch(g).inputs[0]!.config).toBeUndefined();
  });

  test("11 · tape snapshots are never written by in-place edits of h.config, before or after a restore", () => {
    const h = make(10);
    runScripted(h);
    const kf = historyActiveBranch(h).keyframes;
    const frozen = kf.map((k) => JSON.stringify(k.config, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v)));
    historyStateAt(h, "main", 22); // a restore
    edit(h, ["nested", "arr", 0], 1000); // behind the head: pending
    historyTick(h, {}); // lands at the head, written into the live config
    h.config.img[1] = 123; // and raw in-place writes (a lens poking its captured config)
    h.config.nested.a = -5;
    const after = kf.map((k) => JSON.stringify(k.config, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v)));
    expect(after).toEqual(frozen);
  });

  test("12 · historyReset discards pending edits and restarts the tape from the config as it stands", () => {
    const h = make(10);
    runScripted(h);
    historyStateAt(h, "main", 20);
    edit(h, ["nested", "a"], 7); // behind the head → pending
    historyStateAt(h, "main", 30);
    h.config.k = 42; // the rele / una-wacha shape: mutate directly, then reset
    historyReset(h);
    expect(h.config_pending).toBeNull();
    expect(h.config.k).toBe(42);
    historyTick(h, {});
    expect(h.substrate.read.lastK).toBe(42);
    expect(historyActiveBranch(h).inputs[0]!.config).toBeUndefined(); // the root snapshot already holds k 42
  });

  test("13 · historyEditConfig refuses what setByPath silently skipped: a missing parent, an empty path, a non-object parent", () => {
    const h = make(10);
    expect(() => edit(h, ["nope", "x"], 1)).toThrow(/historyEditConfig: .*nope.*not an object/);
    expect(() => edit(h, [], 1)).toThrow(/empty path/);
    expect(() => edit(h, ["k", "x"], 1)).toThrow(/historyEditConfig: .*k.*not an object/);
    historyTick(h, {}); // and a refused edit left nothing pending
    expect(historyActiveBranch(h).inputs[0]!.config).toBeUndefined();
  });

  test("14 · historyTick does not walk the config: an unguarded run never reads a sentinel key, not even on an edit tick", () => {
    let reads = 0;
    const config = makeConfig() as TapeConfig & { sentinel?: number };
    Object.defineProperty(config, "sentinel", { enumerable: true, configurable: true, get: () => { reads++; return 1; } });
    const h = createHistory({ bundle, config, rng_seed: 1, adapter, keyframe_period: 10 });
    const atStart = reads; // the root snapshot read it once
    for (let t = 1; t <= 50; t++) historyTick(h, {});
    expect(reads - atStart, "50 ticks with no edit").toBe(0);
    edit(h, ["k"], 3);
    historyTick(h, {});
    expect(reads - atStart, "an edit records its path, not the config").toBe(0);
  });

  test("15 · a restore walks only what changed: scrubs across no edit never touch a sentinel key; across an edit, only its path", () => {
    let reads = 0;
    const config = makeConfig() as TapeConfig & { sentinel?: number };
    // a GETTER-ONLY key: reading it counts, and writing it throws, so a restore that walked here would be seen
    Object.defineProperty(config, "sentinel", { enumerable: true, configurable: true, get: () => { reads++; return 1; } });
    const h = createHistory({ bundle, config, rng_seed: 1, adapter, keyframe_period: 10 });
    for (let t = 1; t <= 30; t++) { if (t === 17) edit(h, ["k"], 4); historyTick(h, {}); }
    const atStart = reads;
    for (const t of [3, 25, 12, 30, 0, 16, 17, 29]) historyStateAt(h, "main", t);
    expect(reads - atStart).toBe(0);
    historyStateAt(h, "main", 16);
    expect(h.config.k).toBe(1);
    historyStateAt(h, "main", 17);
    expect(h.config.k).toBe(4);
  });
});
