/* spec/32 §1 / §4 — the write path. D2: the console's `speed` set the host's speed id only, while every lens reads
 * its own multiplier, set by `mounted.setSpeed` (the Toolbar calls both: Toolbar.tsx:155-158). Each row names the
 * defect it reproduces. */
import { describe, expect, test } from "vitest";
import { buildConsoleRegistry } from "@/lenses/console-registry";
import type { Lens, LensHost, MountedLens } from "@/lenses/types";
import { createHistory, historyAdvance, historyEditConfig, historyTick, type HistoryAdapter } from "@/history";
import type { SubstrateBundle } from "@/engine/types";

function fakes() {
  const calls: string[] = [];
  const lens = {
    id: "fake", name: "Fake", tunables: [], features: [], target_kind: "canvas2d",
    speeds: [{ id: "1x", label: "1x", mult: 1, isDefault: true }, { id: "2x", label: "2x", mult: 2 }],
  } as unknown as Lens<never, never, never, never>;
  const mounted = {
    setSpeed: (id: string) => calls.push(`lens.setSpeed ${id}`),
    getTunable: () => undefined, setTunable: () => {}, subscribeTunables: () => () => {},
    pause() {}, resume() {}, step() {},
  } as unknown as MountedLens<never>;
  let speedId = "1x";
  const host = {
    isPlaying: () => true, setPlaying() {}, togglePlaying() {}, isActive: () => true,
    getSpeedId: () => speedId, setSpeedId: (id: string) => { speedId = id; calls.push(`host.setSpeedId ${id}`); },
  } as unknown as LensHost;
  return { lens, mounted, host, calls, speedId: () => speedId };
}

describe("D2 — console speed", () => {
  test("`speed 2x` reaches the lens's multiplier AND the host's id", async () => {
    const f = fakes();
    const reg = buildConsoleRegistry({ lens: f.lens, mounted: f.mounted, host: f.host });
    await reg.dispatch("speed", ["2x"]);
    expect(f.calls).toContain("lens.setSpeed 2x");
    expect(f.speedId()).toBe("2x");
  });
  test("an unknown speed is refused with its reason, and nothing is set", async () => {
    const f = fakes();
    const reg = buildConsoleRegistry({ lens: f.lens, mounted: f.mounted, host: f.host });
    expect(() => reg.dispatch("speed", ["9x"])).toThrow(/unknown speed: 9x/);
    expect(f.calls).toEqual([]);
  });
});

type K = { k: number };
type S = { tick: number; seen: number };
const kBundle: SubstrateBundle<S, K, Record<string, never>> = {
  alloc: () => ({ read: { tick: 0, seen: 0 }, write: { tick: 0, seen: 0 } }),
  initState: () => {},
  tick: (r, w, config, rng) => { w.tick = r.tick + 1; w.seen = config.k; return rng; },
};
const kAdapter: HistoryAdapter<S, Record<string, never>, { tick: number }> = {
  root_commit: (s) => ({ tick: s.tick }),
  commit_predicate: () => null,
};

describe("D1 — historyEditConfig on an advance-only history", () => {
  /* ★ spec/32 D1 — FIXED (S248, the owner chose "one shared predicate"). An advance-only history (no recording) never
   * moves its head, so after tick 0 the substrate runs BEYOND it. `historyAdvance` already called that live
   * (`loggedEntryAfter`: a logged config is restored only BEHIND the head) while `historyEditConfig` wrote the live
   * config only EXACTLY at the head — so every edit after tick 0 was parked for a `historyTick` that never came. Both now
   * read one predicate. This row was "D1 STANDS" (pinned at seen === 1) until the fix; its mirror canary was the fix. */
  test("D1: an edit at tick 10 IS seen by the next advanced tick", () => {
    const h = createHistory({ bundle: kBundle, config: { k: 1 }, rng_seed: 1, adapter: kAdapter });
    for (let i = 0; i < 10; i++) historyAdvance(h, {});
    historyEditConfig(h, ["k"], 7);
    historyAdvance(h, {});
    expect(h.substrate.read.tick).toBe(11);
    expect(h.substrate.read.seen).toBe(7);
  });
  /* ★ The leftover the fix leaves (S248): beyond the head an edit is ALSO queued in `config_pending` (so a later
   * `historyTick` still lands and tapes it), and only `historyReset` clears that queue on an advance-only history — a
   * rail slider dragged for a whole run grew it without bound. Consecutive edits to the SAME path now coalesce (the
   * later one replaces the earlier, which it would overwrite anyway); edits to different paths still queue in order. */
  test("D1 leftover: a drag (1000 consecutive edits to one path) leaves ONE pending op, the last value", () => {
    const h = createHistory({ bundle: kBundle, config: { k: 1 }, rng_seed: 1, adapter: kAdapter });
    for (let i = 0; i < 10; i++) historyAdvance(h, {});
    for (let v = 1; v <= 1000; v++) historyEditConfig(h, ["k"], v);
    expect(h.config_pending).toHaveLength(1);
    expect(h.config_pending![0]).toMatchObject({ path: ["k"], value: 1000 });
    historyAdvance(h, {});
    expect(h.substrate.read.seen).toBe(1000);
  });
  test("control: the same edit at tick 0 IS seen (so the row above reads the head rule, not a broken fixture)", () => {
    const h = createHistory({ bundle: kBundle, config: { k: 1 }, rng_seed: 1, adapter: kAdapter });
    historyEditConfig(h, ["k"], 7);
    historyAdvance(h, {});
    expect(h.substrate.read.seen).toBe(7);
  });
});

/* S248 — why coalescing compares only the LAST queued op (found by canary C3: coalescing ANY earlier same-path op left
 * every row green). Edits n.a=5, n={a:1}, n.a=9 must end at a=9; dropping the FIRST n.a (it shares a path with the
 * third) would re-queue as [n.a=9, n={a:1}] and land a=1 at the next tick. */
type N = { n: { a: number } };
type NS = { tick: number; a: number };
const nBundle: SubstrateBundle<NS, N, Record<string, never>> = {
  alloc: () => ({ read: { tick: 0, a: 0 }, write: { tick: 0, a: 0 } }),
  initState: () => {},
  tick: (r, w, config, rng) => { w.tick = r.tick + 1; w.a = config.n.a; return rng; },
};
const nAdapter: HistoryAdapter<NS, Record<string, never>, { tick: number }> = { root_commit: (s) => ({ tick: s.tick }), commit_predicate: () => null };
test("coalescing never reorders across an edit to a parent path (the queue lands in order at the next tick)", () => {
  const h = createHistory({ bundle: nBundle, config: { n: { a: 0 } }, rng_seed: 1, adapter: nAdapter });
  historyEditConfig(h, ["n", "a"], 5);
  historyEditConfig(h, ["n"], { a: 1 });
  historyEditConfig(h, ["n", "a"], 9);
  expect(h.config_pending).toHaveLength(3);
  historyTick(h, {});
  expect(h.substrate.read.a).toBe(9);
  expect(h.config.n.a).toBe(9);
});
