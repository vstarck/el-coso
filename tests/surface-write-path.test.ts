/* spec/32 §1 / §4 — the write path. D2: the console's `speed` set the host's speed id only, while every lens reads
 * its own multiplier, set by `mounted.setSpeed` (the Toolbar calls both: Toolbar.tsx:155-158). Each row names the
 * defect it reproduces. */
import { describe, expect, test } from "vitest";
import { buildConsoleRegistry } from "@/lenses/console-registry";
import type { Lens, LensHost, MountedLens } from "@/lenses/types";
import { createHistory, historyAdvance, historyEditConfig, type HistoryAdapter } from "@/history";
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
  /* ★ REPRODUCES spec/32 D1 (measured first on swarm-swart-grid, la-cosa context/substrates/swarm-swart/ux.md:81).
   * Pins the defect's SIGNATURE — the edit is not seen, the tick still ran and still read the OLD value — rather than
   * `test.fails`, which any failure would satisfy (S248 final review). The day D1 is fixed this row reddens; the
   * owner's chosen fix (spec/32 §4) flips it to expect 7. */
  test("D1 STANDS: an edit at tick 10 is NOT seen by the next advanced tick (the old value is)", () => {
    const h = createHistory({ bundle: kBundle, config: { k: 1 }, rng_seed: 1, adapter: kAdapter });
    for (let i = 0; i < 10; i++) historyAdvance(h, {});
    historyEditConfig(h, ["k"], 7);
    historyAdvance(h, {});
    expect(h.substrate.read.tick).toBe(11);
    expect(h.substrate.read.seen).toBe(1);
  });
  test("control: the same edit at tick 0 IS seen (so the row above reads the head rule, not a broken fixture)", () => {
    const h = createHistory({ bundle: kBundle, config: { k: 1 }, rng_seed: 1, adapter: kAdapter });
    historyEditConfig(h, ["k"], 7);
    historyAdvance(h, {});
    expect(h.substrate.read.seen).toBe(7);
  });
});
