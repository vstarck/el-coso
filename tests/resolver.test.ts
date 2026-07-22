import { describe, expect, test } from "vitest";

import {
  makeEntropyResolve,
  makeRecordResolve,
  makeRngResolve,
  makeTag,
  makeVerifyResolve,
  parseTag,
  resolveDraw,
} from "@/engine/resolver";
import { nextNormal, nextRange, nextUniform } from "@/engine/rng";
import { runHeadless, tick, tickAny, tickReplay } from "@/engine";
import { allocSubstrate } from "@/engine/substrate";
import type {
  ResolutionRecord,
  Resolve,
  RNGState,
  SubstrateBundle,
} from "@/engine/types";
import {
  createHistory,
  historyAdvance,
  historyBranchFrom,
  historySetActiveBranch,
  historyStateAt,
  historyTick,
  historyTruncate,
  type HistoryAdapter,
} from "@/history";

// Resolver seam (spec/27) Stage A. Three layers of locks:
//
//   1. Kernel — resolveDraw consumes the mulberry32 stream bit-identically
//      to the raw nextUniform / nextRange / nextNormal calls it replaces,
//      the weights fold is exact, force keeps stream alignment, and every
//      malformed call throws (never-silent).
//   2. Backings — rng transcript accumulation, verbatim record serving,
//      verify drift detection, entropy shaping.
//   3. Drivers — one synthetic substrate implemented twice (classic
//      nextUniform chain vs mirrored tickResolve) is trajectory-identical
//      through runHeadless, historyTick, and historyStateAt replay on both
//      the keyframe and no-keyframe paths.

const SEEDS = [1, 7, 42];

// --- 1. kernel: bit-identity with the raw rng calls ------------------------

test("plain resolve is bit-identical to nextUniform across seeds", () => {
  for (const seed of SEEDS) {
    let raw: RNGState = { seed };
    let seam: RNGState = { seed };
    for (let i = 0; i < 100; i++) {
      const expected = nextUniform(raw);
      raw = expected.rng;
      const got = resolveDraw(seam, "t:u");
      seam = got.rng;
      expect(got.record.value).toBe(expected.value);
      expect(got.record.kind).toBe("u");
    }
    expect(seam.seed).toBe(raw.seed);
  }
});

test("range resolve is bit-identical to nextRange across seeds", () => {
  for (const seed of SEEDS) {
    let raw: RNGState = { seed };
    let seam: RNGState = { seed };
    for (let i = 0; i < 100; i++) {
      const expected = nextRange(raw, -2, 3);
      raw = expected.rng;
      const got = resolveDraw(seam, "t:r", { range: [-2, 3] });
      seam = got.rng;
      expect(got.record.value).toBe(expected.value);
      expect(got.record.kind).toBe("range");
    }
    expect(seam.seed).toBe(raw.seed);
  }
});

test("normal resolve is bit-identical to nextNormal (2 uniforms) across seeds", () => {
  for (const seed of SEEDS) {
    let raw: RNGState = { seed };
    let seam: RNGState = { seed };
    for (let i = 0; i < 100; i++) {
      const expected = nextNormal(raw);
      raw = expected.rng;
      const got = resolveDraw(seam, "t:n", { normal: true });
      seam = got.rng;
      expect(got.record.value).toBe(expected.value);
      expect(got.record.kind).toBe("normal");
    }
    expect(seam.seed).toBe(raw.seed);
  }
});

test("arity fold lands bit-identically on the floor(u*n) idiom, consuming 1 uniform", () => {
  for (const seed of SEEDS) {
    for (const n of [1, 2, 3, 4, 7]) {
      let raw: RNGState = { seed };
      let seam: RNGState = { seed };
      for (let i = 0; i < 50; i++) {
        const u = nextUniform(raw);
        raw = u.rng;
        const got = resolveDraw(seam, "t:a", { arity: n });
        seam = got.rng;
        expect(got.record.value).toBe(Math.min(n - 1, Math.floor(u.value * n)));
        expect(got.record.kind).toBe("index");
        expect(seam.seed).toBe(raw.seed); // exactly one uniform consumed
      }
    }
  }
});

describe("weights fold", () => {
  // Entropy backing injects exact uniforms, so fold boundaries are testable
  // directly (the rng backing shares the identical fold code path).
  function foldAt(u: number, weights: number[]): number {
    const { resolve } = makeEntropyResolve(() => u);
    return resolve("t:w", { weights });
  }

  test("left-to-right cumulative fold with exact boundaries", () => {
    // weights [1, 1]: total 2, cut at u = 0.5 exactly → index 1 (u < cdf is
    // strict, matching floor semantics).
    expect(foldAt(0, [1, 1])).toBe(0);
    expect(foldAt(0.49999, [1, 1])).toBe(0);
    expect(foldAt(0.5, [1, 1])).toBe(1);
    // Non-uniform [2, 1, 3]: cuts at 1/3 and 1/2.
    expect(foldAt(0.1, [2, 1, 3])).toBe(0);
    expect(foldAt(0.375, [2, 1, 3])).toBe(1);
    expect(foldAt(0.499, [2, 1, 3])).toBe(1);
    expect(foldAt(0.5, [2, 1, 3])).toBe(2);
    expect(foldAt(0.999, [2, 1, 3])).toBe(2);
  });

  test("a zero-weight outcome is never selected by a draw", () => {
    for (const u of [0, 0.2, 0.4999, 0.5, 0.7, 0.99]) {
      expect(foldAt(u, [1, 0, 1])).not.toBe(1);
      expect(foldAt(u, [0, 1])).toBe(1);
    }
    // Interior zero: weight 2 covers [0.25, 0.75) of the mass around it.
    expect(foldAt(0.3, [1, 0, 2, 1])).toBe(2);
  });

  test("single-outcome weights always resolve to 0", () => {
    for (const u of [0, 0.5, 0.999]) expect(foldAt(u, [5])).toBe(0);
  });

  test("weighted draw through the rng backing matches a hand fold of the same uniform", () => {
    const weights = [2, 1, 3];
    for (const seed of SEEDS) {
      let raw: RNGState = { seed };
      let seam: RNGState = { seed };
      for (let i = 0; i < 50; i++) {
        const u = nextUniform(raw);
        raw = u.rng;
        const scaled = u.value * 6;
        const expected = scaled < 2 ? 0 : scaled < 3 ? 1 : 2;
        const got = resolveDraw(seam, "t:w", { weights });
        seam = got.rng;
        expect(got.record.value).toBe(expected);
        expect(seam.seed).toBe(raw.seed); // exactly one uniform regardless of arity
      }
    }
  });
});

// --- 1b. kernel: force alignment -------------------------------------------

test("force consumes the same draws as an unforced call (counterfactual twin)", () => {
  for (const seed of SEEDS) {
    const run = (forceThird: boolean) => {
      let rng: RNGState = { seed };
      const values: number[] = [];
      const kinds: Array<{ tag: string; opts?: Parameters<typeof resolveDraw>[2] }> = [
        { tag: "t:1" },
        { tag: "t:2", opts: { normal: true } },
        { tag: "t:3", opts: forceThird ? { arity: 4, force: 2 } : { arity: 4 } },
        { tag: "t:4", opts: { range: [0, 10] } },
        { tag: "t:5" },
      ];
      const records: ResolutionRecord[] = [];
      for (const c of kinds) {
        const r = resolveDraw(rng, c.tag, c.opts);
        rng = r.rng;
        values.push(r.record.value);
        records.push(r.record);
      }
      return { rng, values, records };
    };
    const plain = run(false);
    const forced = run(true);
    // Downstream of the forced call: identical values, identical final rng.
    expect(forced.values[3]).toBe(plain.values[3]);
    expect(forced.values[4]).toBe(plain.values[4]);
    expect(forced.rng.seed).toBe(plain.rng.seed);
    // The forced record carries the frozen forced answer + audit flag.
    expect(forced.values[2]).toBe(2);
    expect(forced.records[2]!.forced).toBe(true);
    expect(plain.records[2]!.forced).toBeUndefined();
  }
});

test("force may select a zero-weight outcome (that is what force means)", () => {
  const r = resolveDraw({ seed: 1 }, "t:w", { weights: [1, 0], force: 1 });
  expect(r.record.value).toBe(1);
  expect(r.record.forced).toBe(true);
});

test("note is copied onto the record", () => {
  const r = resolveDraw({ seed: 1 }, "t:u", { note: { why: "test" } });
  expect(r.record.note).toEqual({ why: "test" });
});

// --- 1c. kernel: validation, never-silent -----------------------------------

describe("malformed calls throw", () => {
  const rng: RNGState = { seed: 1 };
  test("two draw kinds at once", () => {
    expect(() => resolveDraw(rng, "t", { arity: 2, normal: true })).toThrow(/one draw kind/);
    expect(() => resolveDraw(rng, "t", { weights: [1], range: [0, 1] })).toThrow(/one draw kind/);
  });
  test("bad arity", () => {
    expect(() => resolveDraw(rng, "t", { arity: 0 })).toThrow(/arity/);
    expect(() => resolveDraw(rng, "t", { arity: 1.5 })).toThrow(/arity/);
  });
  test("bad range", () => {
    expect(() => resolveDraw(rng, "t", { range: [1, 1] })).toThrow(/range/);
    expect(() => resolveDraw(rng, "t", { range: [2, 1] })).toThrow(/range/);
    expect(() => resolveDraw(rng, "t", { range: [Number.NaN, 3] })).toThrow(/range/);
    expect(() => resolveDraw(rng, "t", { range: [0, Infinity] })).toThrow(/range/);
  });
  test("bad weights", () => {
    expect(() => resolveDraw(rng, "t", { weights: [] })).toThrow(/weights/);
    expect(() => resolveDraw(rng, "t", { weights: [Number.NaN] })).toThrow(/weights/);
    expect(() => resolveDraw(rng, "t", { weights: [-1, 2] })).toThrow(/weights/);
    expect(() => resolveDraw(rng, "t", { weights: [0, 0] })).toThrow(/weights/);
  });
  test("force outside the kind's domain", () => {
    expect(() => resolveDraw(rng, "t", { force: 1 })).toThrow(/force/); // plain: [0,1)
    expect(() => resolveDraw(rng, "t", { force: -0.1 })).toThrow(/force/);
    expect(() => resolveDraw(rng, "t", { arity: 3, force: 1.5 })).toThrow(/force/);
    expect(() => resolveDraw(rng, "t", { arity: 3, force: 3 })).toThrow(/force/);
    expect(() => resolveDraw(rng, "t", { arity: 3, force: -1 })).toThrow(/force/);
    expect(() => resolveDraw(rng, "t", { range: [0, 1], force: 1 })).toThrow(/force/);
    expect(() => resolveDraw(rng, "t", { normal: true, force: Number.NaN })).toThrow(/force/);
    expect(() => resolveDraw(rng, "t", { normal: true, force: Infinity })).toThrow(/force/);
  });
  test("empty tag", () => {
    expect(() => resolveDraw(rng, "")).toThrow(/tag/);
  });
  test("entropy draw outside [0,1)", () => {
    expect(() => makeEntropyResolve(() => 1).resolve("t")).toThrow(/entropy/);
    expect(() => makeEntropyResolve(() => -0.1).resolve("t")).toThrow(/entropy/);
    expect(() => makeEntropyResolve(() => Number.NaN).resolve("t")).toThrow(/entropy/);
  });
});

// --- 1d. tags ---------------------------------------------------------------

describe("tag discipline", () => {
  test("makeTag joins with ':' and parseTag round-trips", () => {
    const t = makeTag("tron");
    expect(t("ai-turn", 3)).toBe("tron:ai-turn:3");
    expect(t()).toBe("tron");
    expect(parseTag(t("ai-turn", 3))).toEqual(["tron", "ai-turn", "3"]);
    expect(parseTag("solo")).toEqual(["solo"]);
  });
  test("empty parts and ':' in parts throw", () => {
    expect(() => makeTag("")).toThrow(/tag part/);
    expect(() => makeTag("a:b")).toThrow(/separator/);
    expect(() => makeTag("ok")("")).toThrow(/tag part/);
    expect(() => makeTag("ok")("x:y")).toThrow(/separator/);
    expect(() => parseTag("a::b")).toThrow(/tag part/);
    expect(() => parseTag("")).toThrow(/tag part/);
  });
});

// --- 2. backings ------------------------------------------------------------

// A little mixed-call script every backing test reuses.
function runScript(resolve: Resolve): number[] {
  return [
    resolve("s:u"),
    resolve("s:idx", { weights: [1, 2, 0, 1] }),
    resolve("s:rng", { range: [5, 9] }),
    resolve("s:n", { normal: true }),
    resolve("s:forced", { arity: 3, force: 1, note: "pinned" }),
  ];
}

test("makeRngResolve accumulates the transcript and threads the rng", () => {
  const live = makeRngResolve({ seed: 11 });
  const values = runScript(live.resolve);
  const done = live.finish();
  expect(done.records.map((r) => r.kind)).toEqual(["u", "index", "range", "normal", "index"]);
  expect(done.records.map((r) => r.value)).toEqual(values);
  expect(done.records[4]!.forced).toBe(true);
  expect(done.records[4]!.note).toBe("pinned");
  // Records are plain data (survive the history layer's clone helpers).
  expect(JSON.parse(JSON.stringify(done.records))).toEqual(done.records);
  // Stream position: 6 uniforms consumed (normal takes 2, forced still draws).
  let rng: RNGState = { seed: 11 };
  for (let i = 0; i < 6; i++) rng = nextUniform(rng).rng;
  expect(done.rng.seed).toBe(rng.seed);
  // One-per-tick discipline: resolving after finish throws.
  expect(() => live.resolve("s:late")).toThrow(/finish/);
});

describe("makeRecordResolve serves verbatim and positionally", () => {
  function liveRecords(): ResolutionRecord[] {
    const live = makeRngResolve({ seed: 11 });
    runScript(live.resolve);
    return live.finish().records;
  }

  test("an aligned replay returns the recorded values without re-derivation", () => {
    const records = liveRecords();
    const replay = makeRecordResolve(records);
    // Values come from the transcript — no rng anywhere in sight.
    expect(runScript(replay.resolve)).toEqual(records.map((r) => r.value));
    replay.finish(); // fully consumed — no throw
  });

  test("tag mismatch, kind mismatch, exhaustion, and leftover all throw", () => {
    const records = liveRecords();

    const wrongTag = makeRecordResolve(records);
    expect(() => wrongTag.resolve("s:other")).toThrow(/tag/);

    const wrongKind = makeRecordResolve(records);
    expect(() => wrongKind.resolve("s:u", { normal: true })).toThrow(/kind/);

    const exhausted = makeRecordResolve(records);
    runScript(exhausted.resolve);
    expect(() => exhausted.resolve("s:extra")).toThrow(/exhausted/);

    const leftover = makeRecordResolve(records);
    leftover.resolve("s:u");
    expect(() => leftover.finish()).toThrow(/unconsumed/);
  });
});

describe("makeVerifyResolve re-derives and compares", () => {
  function liveRun() {
    const live = makeRngResolve({ seed: 11 });
    runScript(live.resolve);
    return live.finish();
  }

  test("an untouched transcript verifies clean, threading the same rng", () => {
    const done = liveRun();
    const verify = makeVerifyResolve({ seed: 11 }, done.records);
    expect(runScript(verify.resolve)).toEqual(done.records.map((r) => r.value));
    expect(verify.finish().rng.seed).toBe(done.rng.seed);
  });

  test("a mutated record throws with position context", () => {
    for (const mutate of [
      (r: ResolutionRecord) => ({ ...r, value: r.value + 1 }),
      (r: ResolutionRecord) => ({ ...r, tag: "s:tampered" }),
      (r: ResolutionRecord) => ({ ...r, kind: "u" as const }), // record 2 is a range draw
    ]) {
      const done = liveRun();
      const records = [...done.records];
      records[2] = mutate(records[2]!);
      const verify = makeVerifyResolve({ seed: 11 }, records);
      expect(() => runScript(verify.resolve)).toThrow(/position 2/);
    }
    // Forced-flag drift is drift too.
    const done = liveRun();
    const records = [...done.records];
    const r4 = records[4]!;
    records[4] = { tag: r4.tag, kind: r4.kind, value: r4.value, note: r4.note };
    const verify = makeVerifyResolve({ seed: 11 }, records);
    expect(() => runScript(verify.resolve)).toThrow(/position 4/);
  });
});

test("makeEntropyResolve shapes injected uniforms and returns the transcript", () => {
  const feed = [0.5, 0.25, 0.5, 0.5, 0.5, 0.99];
  let i = 0;
  const entropy = makeEntropyResolve(() => feed[i++]!);
  const values = runScript(entropy.resolve);
  const { records } = entropy.finish();
  expect(values[0]).toBe(0.5); // plain: verbatim u
  expect(values[1]).toBe(1); // weights [1,2,0,1]: 0.25*4=1 → index 1
  expect(values[2]).toBe(5 + 0.5 * 4); // range [5,9)
  expect(values[4]).toBe(1); // forced (consumed 0.99, returned force)
  expect(records.map((r) => r.value)).toEqual(values);
  expect(records[4]!.forced).toBe(true);
});

// --- 3. drivers: the twin synthetic substrate -------------------------------
//
// One substrate, two implementations. The classic twin threads RNGState
// through the raw rng calls (incl. the floor(u*n) and hand-rolled cumulative
// fold idioms pre-seam substrates use); the resolver twin mirrors every draw
// through `resolve`. Trajectories must be bit-identical through every
// driver. Draw structure is state-dependent (the extra draw below), so
// alignment is exercised, not just count.

type TwinState = {
  tick: number;
  acc: number;
  pos: number;
  gauss: number;
  picks: number;
};
type TwinConfig = { bias: number };
type TwinInput = { nudge: number };

function makeTwinState(): TwinState {
  return { tick: 0, acc: 0, pos: 0, gauss: 0, picks: 0 };
}

const twinAlloc = () => ({ read: makeTwinState(), write: makeTwinState() });
const twinInit = (state: TwinState) => {
  state.pos = 1;
};

const classicTwin: SubstrateBundle<TwinState, TwinConfig, TwinInput> = {
  alloc: twinAlloc,
  initState: twinInit,
  tick: (r, w, config, rng, inputs) => {
    w.tick = r.tick + 1;
    const u = nextUniform(rng);
    rng = u.rng;
    w.acc = r.acc + u.value;
    let pos = r.pos + inputs.nudge;
    if (u.value < config.bias) {
      const extra = nextRange(rng, -2, 3);
      rng = extra.rng;
      pos += extra.value;
    }
    w.pos = pos;
    const n = nextNormal(rng);
    rng = n.rng;
    w.gauss = r.gauss + n.value;
    // Equal 3-way pick, floor idiom.
    const p1 = nextUniform(rng);
    rng = p1.rng;
    const equal = Math.min(2, Math.floor(p1.value * 3));
    // Weighted [1,2,0,1] pick, hand-rolled cumulative fold.
    const p2 = nextUniform(rng);
    rng = p2.rng;
    const scaled = p2.value * 4;
    const weighted = scaled < 1 ? 0 : scaled < 3 ? 1 : 3;
    w.picks = (r.picks * 7 + equal * 5 + weighted) % 1000003;
    return rng;
  },
};

const twinTag = makeTag("twin");

const resolverTwin: SubstrateBundle<TwinState, TwinConfig, TwinInput> = {
  alloc: twinAlloc,
  initState: twinInit,
  tickResolve: (r, w, config, resolve, inputs) => {
    w.tick = r.tick + 1;
    const u = resolve(twinTag("u"));
    w.acc = r.acc + u;
    let pos = r.pos + inputs.nudge;
    if (u < config.bias) {
      pos += resolve(twinTag("extra"), { range: [-2, 3] });
    }
    w.pos = pos;
    w.gauss = r.gauss + resolve(twinTag("gauss"), { normal: true });
    const equal = resolve(twinTag("equal"), { arity: 3 });
    const weighted = resolve(twinTag("weighted"), { weights: [1, 2, 0, 1] });
    w.picks = (r.picks * 7 + equal * 5 + weighted) % 1000003;
  },
};

const CONFIG: TwinConfig = { bias: 0.4 };
const twinAdapter: HistoryAdapter<TwinState, TwinInput, string> = {
  root_commit: () => "root",
  commit_predicate: () => null,
};

function twinInputs(ticks: number): TwinInput[] {
  const out: TwinInput[] = [];
  for (let i = 0; i < ticks; i++) out.push({ nudge: i % 3 === 0 ? 1 : -1 });
  return out;
}

test("twin bundles are trajectory-identical through runHeadless", () => {
  for (const seed of SEEDS) {
    const classic = runHeadless(classicTwin, CONFIG, seed, twinInputs(200));
    const seam = runHeadless(resolverTwin, CONFIG, seed, twinInputs(200));
    expect(seam).toEqual(classic);
  }
});

test("twin bundles are trajectory-identical through historyTick + historyStateAt replay", () => {
  for (const keyframe_period of [50, Infinity]) {
    const mk = (bundle: SubstrateBundle<TwinState, TwinConfig, TwinInput>) =>
      createHistory({
        bundle,
        config: CONFIG,
        rng_seed: 7,
        adapter: twinAdapter,
        keyframe_period,
      });
    const classic = mk(classicTwin);
    const seam = mk(resolverTwin);
    const inputs = twinInputs(150);
    for (const input of inputs) {
      historyTick(classic, input);
      historyTick(seam, input);
    }
    // The replay target must also equal the LIVE state that passed through
    // that tick — replay reproduces the trajectory, not just twin symmetry.
    const liveAt137 = runHeadless(resolverTwin, CONFIG, 7, twinInputs(137));

    // keyframe_period 50: tick 137 restores from the tick-100 keyframe and
    // replays 37 ticks; Infinity: replays all 137 from the root state.
    const classicAt = historyStateAt(classic, "main", 137);
    const seamAt = historyStateAt(seam, "main", 137);
    expect(seamAt).toEqual(classicAt);
    expect(seamAt).toEqual(liveAt137);
  }
});

test("historyStateAt scrub back and forth stays deterministic on a resolver bundle", () => {
  const h = createHistory({
    bundle: resolverTwin,
    config: CONFIG,
    rng_seed: 3,
    adapter: twinAdapter,
    keyframe_period: 40,
  });
  const inputs = twinInputs(120);
  for (const input of inputs) historyTick(h, input);
  const at90a = { ...historyStateAt(h, "main", 90) };
  historyStateAt(h, "main", 17);
  historyStateAt(h, "main", 120);
  const at90b = { ...historyStateAt(h, "main", 90) };
  expect(at90b).toEqual(at90a);
});

// --- 3b. drivers: bundle-shape rules ----------------------------------------

test("a bundle with neither tick nor tickResolve throws at the driver", () => {
  const hollow = {
    alloc: twinAlloc,
    initState: twinInit,
  } as SubstrateBundle<TwinState, TwinConfig, TwinInput>;
  const substrate = allocSubstrate(hollow, CONFIG);
  expect(() => tickAny(hollow, substrate, CONFIG, { seed: 1 }, { nudge: 0 })).toThrow(
    /neither tick nor tickResolve/,
  );
  expect(() =>
    tickReplay(hollow, substrate, CONFIG, { seed: 1 }, { nudge: 0 }, null),
  ).toThrow(/neither tick nor tickResolve/);
});

test("the classic tick free function refuses a tickResolve-only bundle", () => {
  const substrate = allocSubstrate(resolverTwin, CONFIG);
  expect(() => tick(resolverTwin, substrate, CONFIG, { seed: 1 }, { nudge: 0 })).toThrow(
    /tickAny/,
  );
});

test("when both tick and tickResolve are present, drivers use tickResolve", () => {
  // A both-shaped bundle whose classic tick would poison the state if used.
  const both: SubstrateBundle<TwinState, TwinConfig, TwinInput> = {
    alloc: twinAlloc,
    initState: twinInit,
    tick: (r, w, _config, rng) => {
      w.tick = r.tick + 1;
      w.acc = -999;
      return rng;
    },
    tickResolve: resolverTwin.tickResolve!,
  };
  const viaAny = allocSubstrate(both, CONFIG);
  tickAny(both, viaAny, CONFIG, { seed: 5 }, { nudge: 1 });
  expect(viaAny.write.acc).not.toBe(-999);
  const viaReplay = allocSubstrate(both, CONFIG);
  tickReplay(both, viaReplay, CONFIG, { seed: 5 }, { nudge: 1 }, null);
  expect(viaReplay.write.acc).not.toBe(-999);
});

test("tickAny with an entropy backing returns the transcript and skips the rng", () => {
  const substrate = allocSubstrate(resolverTwin, CONFIG);
  const feed = [0.9, 0.5, 0.5, 0.5, 0.5]; // u=0.9 ≥ bias → no extra draw
  let i = 0;
  const out = tickAny(resolverTwin, substrate, CONFIG, { seed: 123 }, { nudge: 1 }, () => feed[i++]!);
  expect(out.rng.seed).toBe(123); // vestigial under entropy
  expect(out.records!.map((r) => r.tag)).toEqual([
    "twin:u",
    "twin:gauss",
    "twin:equal",
    "twin:weighted",
  ]);
  // And the transcript replays the exact same state transition (record path).
  const twin = allocSubstrate(resolverTwin, CONFIG);
  tickReplay(resolverTwin, twin, CONFIG, { seed: 999 }, { nudge: 1 }, out.records);
  expect(twin.write).toEqual(substrate.write);
});

test("tickAny on a classic bundle reports records: null", () => {
  const substrate = allocSubstrate(classicTwin, CONFIG);
  const out = tickAny(classicTwin, substrate, CONFIG, { seed: 5 }, { nudge: 1 });
  expect(out.records).toBeNull();
});

// --- 4. Stage B: the transcript on the history layer ------------------------
//
// resolver_mode "verify" records transcripts and replays as re-derive +
// compare (drift detector); "entropy" backs live chance with an injected
// unseeded draw, making the transcript the ONLY record of the past. The
// transcript rides InputEntry, so fork/truncate slice it with the input log
// by construction.

// Deterministic-but-unseeded uniform source (golden-ratio low-discrepancy) —
// deliberately unrelated to the mulberry32 stream.
function goldenDraw(): () => number {
  let i = 0;
  return () => (++i * 0.6180339887498949) % 1;
}

function mkHistory(opts: {
  bundle?: SubstrateBundle<TwinState, TwinConfig, TwinInput>;
  mode?: "rng" | "verify" | "entropy";
  entropy?: () => number;
  keyframe_period?: number;
  seed?: number;
}) {
  return createHistory({
    bundle: opts.bundle ?? resolverTwin,
    config: CONFIG,
    rng_seed: opts.seed ?? 7,
    adapter: twinAdapter,
    keyframe_period: opts.keyframe_period ?? Infinity,
    ...(opts.mode !== undefined ? { resolver_mode: opts.mode } : {}),
    ...(opts.entropy !== undefined ? { entropy_draw: opts.entropy } : {}),
  });
}

test("rng mode (default) records no transcript", () => {
  const h = mkHistory({});
  for (const input of twinInputs(10)) historyTick(h, input);
  const main = h.branches["main"]!;
  expect(main.inputs.length).toBe(10);
  expect(main.inputs.every((e) => e.resolutions === undefined)).toBe(true);
});

test("verify mode: transcripts recorded live; scrub replay re-derives + compares clean", () => {
  for (const keyframe_period of [25, Infinity]) {
    const h = mkHistory({ mode: "verify", keyframe_period, seed: 11 });
    const liveStates: TwinState[] = [];
    for (const input of twinInputs(60)) {
      historyTick(h, input);
      liveStates.push({ ...h.substrate.read });
    }
    const main = h.branches["main"]!;
    expect(main.inputs.every((e) => (e.resolutions?.length ?? 0) > 0)).toBe(true);
    // Scrubbing replays through makeVerifyResolve — clean transcript passes
    // and reproduces the live trajectory.
    expect({ ...historyStateAt(h, "main", 37) }).toEqual(liveStates[36]);
    expect({ ...historyStateAt(h, "main", 60) }).toEqual(liveStates[59]);
  }
});

test("verify mode: a mutated record throws with position context on replay", () => {
  for (const mutate of [
    (r: ResolutionRecord) => ({ ...r, value: r.value + 1 }),
    (r: ResolutionRecord) => ({ ...r, tag: "twin:tampered" }),
    (r: ResolutionRecord) => ({ ...r, kind: "range" as const }), // record 0 is a plain u
  ]) {
    const h = mkHistory({ mode: "verify", seed: 11 });
    for (const input of twinInputs(40)) historyTick(h, input);
    const entry = h.branches["main"]!.inputs[29]!; // tick 30
    entry.resolutions![0] = mutate(entry.resolutions![0]!);
    // Target past the mutated tick so the root-anchored replay crosses it.
    expect(() => historyStateAt(h, "main", 35)).toThrow(/verify drift at position 0/);
  }
});

test("entropy mode: transcripts are the only past — replay survives scrambled seeds", () => {
  for (const keyframe_period of [25, Infinity]) {
    const h = mkHistory({ mode: "entropy", entropy: goldenDraw(), keyframe_period });
    const liveStates: TwinState[] = [];
    for (const input of twinInputs(60)) {
      historyTick(h, input);
      liveStates.push({ ...h.substrate.read });
    }
    const main = h.branches["main"]!;
    expect(main.inputs.every((e) => (e.resolutions?.length ?? 0) > 0)).toBe(true);
    // Scramble every seed replay could touch: nothing may re-derive from it.
    h.rng_seed_initial = 999999;
    h.rng = { seed: 424242 };
    for (const b of Object.values(h.branches)) {
      for (const k of b.keyframes) k.rng.seed = 31337;
    }
    // Keyframe path (period 25: tick 37 restores kf 25) and root path
    // (Infinity: full replay from tick 0) both reproduce the live states.
    expect({ ...historyStateAt(h, "main", 37) }).toEqual(liveStates[36]);
    expect({ ...historyStateAt(h, "main", 5) }).toEqual(liveStates[4]);
    expect({ ...historyStateAt(h, "main", 60) }).toEqual(liveStates[59]);
  }
});

test("entropy mode: fork + truncate keep transcripts aligned with inputs", () => {
  const h = mkHistory({ mode: "entropy", entropy: goldenDraw(), keyframe_period: 10 });
  const mainStates: TwinState[] = [];
  for (const input of twinInputs(30)) {
    historyTick(h, input);
    mainStates.push({ ...h.substrate.read });
  }
  historyBranchFrom(h, "main", 20, "alt");
  historySetActiveBranch(h, "alt"); // anchors at 20 via transcript replay
  const altStates: TwinState[] = [];
  for (const input of twinInputs(10)) {
    historyTick(h, input);
    altStates.push({ ...h.substrate.read });
  }
  // Hop across branches — each hop replays that branch's own transcript
  // segment (lineage: main's entries to the fork, alt's after).
  expect({ ...historyStateAt(h, "main", 30) }).toEqual(mainStates[29]);
  expect({ ...historyStateAt(h, "alt", 30) }).toEqual(altStates[9]);
  expect({ ...historyStateAt(h, "alt", 25) }).toEqual(altStates[4]);
  // Truncate slices inputs and transcripts together (they are one array).
  historyTruncate(h, "alt", 23);
  const alt = h.branches["alt"]!;
  expect(alt.inputs.length).toBe(3);
  expect(alt.inputs.every((e) => (e.resolutions?.length ?? 0) > 0)).toBe(true);
  expect({ ...historyStateAt(h, "alt", 23) }).toEqual(altStates[2]);
  // And the branch keeps ticking live off the truncated head.
  historySetActiveBranch(h, "alt");
  historyTick(h, { nudge: 1 });
  expect(h.substrate.read.tick).toBe(24);
});

test("entropy-mode guard: classic bundle or missing entropy_draw throws at historyTick", () => {
  const classic = mkHistory({ bundle: classicTwin, mode: "entropy", entropy: goldenDraw() });
  expect(() => historyTick(classic, { nudge: 0 })).toThrow(/tickResolve bundle/);
  const missing = mkHistory({ mode: "entropy" });
  expect(() => historyTick(missing, { nudge: 0 })).toThrow(/entropy_draw/);
});

// A twin variant that resolves only on some ticks — locks the
// absent-resolutions round-trip (entry without transcript ⇒ replay expects
// zero draws there) and Invariant 10's no-fallback throw.
const sparseTwin: SubstrateBundle<TwinState, TwinConfig, TwinInput> = {
  alloc: twinAlloc,
  initState: twinInit,
  tickResolve: (r, w, _config, resolve, inputs) => {
    w.tick = r.tick + 1;
    w.pos = r.pos + inputs.nudge;
    w.gauss = r.gauss;
    w.picks = r.picks;
    w.acc =
      inputs.nudge > 0
        ? r.acc + resolve(twinTag("u"), { note: { why: ["sparse", 2] } })
        : r.acc;
  },
};

test("entropy mode: ticks that resolve nothing carry no transcript and replay clean", () => {
  const h = mkHistory({ bundle: sparseTwin, mode: "entropy", entropy: goldenDraw() });
  const liveStates: TwinState[] = [];
  for (const input of twinInputs(30)) {
    // twinInputs: nudge +1 every 3rd tick, -1 otherwise → sparse draws
    historyTick(h, input);
    liveStates.push({ ...h.substrate.read });
  }
  const main = h.branches["main"]!;
  expect(main.inputs.some((e) => e.resolutions === undefined)).toBe(true);
  expect(main.inputs.some((e) => (e.resolutions?.length ?? 0) > 0)).toBe(true);
  expect({ ...historyStateAt(h, "main", 20) }).toEqual(liveStates[19]);
  expect({ ...historyStateAt(h, "main", 30) }).toEqual(liveStates[29]);
});

test("entropy mode: a missing transcript where the bundle resolves throws, never seed-falls-back", () => {
  const h = mkHistory({ mode: "entropy", entropy: goldenDraw() });
  for (const input of twinInputs(10)) historyTick(h, input);
  // Simulate a lost transcript on tick 5 (the bundle resolves every tick).
  delete h.branches["main"]!.inputs[4]!.resolutions;
  expect(() => historyStateAt(h, "main", 8)).toThrow(/exhausted/);
});

test("resolutions are plain data: clones round-trip and replay verbatim (incl. note)", () => {
  const h = mkHistory({ bundle: sparseTwin, mode: "entropy", entropy: goldenDraw() });
  const liveStates: TwinState[] = [];
  for (const input of twinInputs(6)) {
    historyTick(h, input);
    liveStates.push({ ...h.substrate.read });
  }
  const main = h.branches["main"]!;
  const drawing = main.inputs.find((e) => e.resolutions !== undefined)!;
  expect(drawing.resolutions![0]!.note).toEqual({ why: ["sparse", 2] });
  // Plain-data lock: JSON and structuredClone both round-trip unmangled.
  expect(JSON.parse(JSON.stringify(drawing.resolutions))).toEqual(drawing.resolutions);
  expect(structuredClone(drawing.resolutions)).toEqual(drawing.resolutions);
  // A cloned transcript replays through historyAdvance verbatim.
  const at = drawing.tick;
  historyStateAt(h, "main", at - 1);
  historyAdvance(h, drawing.input, structuredClone(drawing.resolutions)!);
  expect({ ...h.substrate.read }).toEqual(liveStates[at - 1]);
});
