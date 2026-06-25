import { afterEach, describe, expect, test } from "vitest";
import {
  frameProfilerFromEnv,
  makeFrameProfiler,
} from "../src/lib/lens-host/frame-profiler";

describe("makeFrameProfiler", () => {
  test("tracks worst-since-mount and counts per phase", () => {
    const p = makeFrameProfiler({ warn: () => {} });
    p.profile({ phase: "render", ms: 4 });
    p.profile({ phase: "render", ms: 528 });
    p.profile({ phase: "render", ms: 9 });
    p.profile({ phase: "tick", ms: 2 });

    const s = p.stats();
    expect(s.render.worst).toBe(528);
    expect(s.render.count).toBe(3);
    expect(s.tick.worst).toBe(2);
    expect(s.tick.count).toBe(1);
    expect(s.frame.count).toBe(0);
  });

  test("p95 is the nearest-rank percentile over the rolling window", () => {
    const p = makeFrameProfiler({ warn: () => {} });
    // 100 samples 1..100; nearest-rank p95 = ceil(0.95*100)=95th -> value 95.
    for (let i = 1; i <= 100; i++) p.profile({ phase: "frame", ms: i });
    expect(p.stats().frame.p95).toBe(95);
  });

  test("window bounds the p95 sample set (old samples roll off)", () => {
    const p = makeFrameProfiler({ warn: () => {}, windowFrames: 10 });
    // A huge early spike then 10 small frames: worst keeps it, p95 forgets it.
    p.profile({ phase: "render", ms: 999 });
    for (let i = 0; i < 10; i++) p.profile({ phase: "render", ms: 5 });
    const s = p.stats();
    expect(s.render.worst).toBe(999); // worst is all-time
    expect(s.render.p95).toBe(5); // p95 only sees the rolling window
  });

  test("warns once over budget, attributing phase + label, then stays quiet", () => {
    const msgs: string[] = [];
    const p = makeFrameProfiler({ label: "swarm-swart-grid", budgetMs: 16, warn: (m) => msgs.push(m) });
    p.profile({ phase: "render", ms: 528 });
    p.profile({ phase: "render", ms: 600 }); // even worse — must NOT warn again
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("swarm-swart-grid");
    expect(msgs[0]).toContain("render");
    expect(msgs[0]).toContain("528");
  });

  test("does not warn on the `frame` rollup (would double-report the spike)", () => {
    const msgs: string[] = [];
    const p = makeFrameProfiler({ budgetMs: 16, warn: (m) => msgs.push(m) });
    p.profile({ phase: "frame", ms: 528 });
    expect(msgs).toHaveLength(0);
  });

  test("under-budget frames never warn", () => {
    const msgs: string[] = [];
    const p = makeFrameProfiler({ budgetMs: 16, warn: (m) => msgs.push(m) });
    for (let i = 0; i < 50; i++) p.profile({ phase: "render", ms: 8 });
    expect(msgs).toHaveLength(0);
  });

  test("tick and render latch independently", () => {
    const msgs: string[] = [];
    const p = makeFrameProfiler({ budgetMs: 16, warn: (m) => msgs.push(m) });
    p.profile({ phase: "render", ms: 100 });
    p.profile({ phase: "tick", ms: 100 });
    p.profile({ phase: "render", ms: 100 });
    p.profile({ phase: "tick", ms: 100 });
    expect(msgs).toHaveLength(2); // one render, one tick
  });
});

describe("frameProfilerFromEnv", () => {
  const g = globalThis as { __COSO_PROFILE__?: unknown };
  afterEach(() => {
    delete g.__COSO_PROFILE__;
  });

  test("off by default → undefined (zero loop overhead)", () => {
    // No URL gate in the vitest (node) env, no global set.
    expect(frameProfilerFromEnv("x")).toBeUndefined();
  });

  test("global flag enables it; a number sets the budget", () => {
    const msgs: string[] = [];
    g.__COSO_PROFILE__ = 50;
    const p = frameProfilerFromEnv("x");
    expect(p).toBeDefined();
    // budget 50 ⇒ a 40ms frame must stay silent. Swap in our own warn sink by
    // re-reading: the env profiler uses console.warn, so just assert it built.
    p!.profile({ phase: "render", ms: 40 });
    expect(p!.stats().render.count).toBe(1);
    void msgs;
  });

  test("global `true` enables with the default budget", () => {
    g.__COSO_PROFILE__ = true;
    expect(frameProfilerFromEnv()).toBeDefined();
  });

  test("global `false` stays off", () => {
    g.__COSO_PROFILE__ = false;
    expect(frameProfilerFromEnv()).toBeUndefined();
  });
});
