import { afterEach, describe, expect, it, vi } from "vitest";
import { attachRafLoopCore } from "../src/lib/lens-host/raf-loop-core";
import type { FpsStats } from "../src/lib/lens-host/fps-stats";

// Drive the loop with a controllable clock + manual rAF so we can assert the
// loop feeds the fps accumulator and reports an FpsStats every ~500ms. Passing
// `isActive` keeps the loop from touching window/document (no focus listeners).
function harness() {
  let nowMs = 0;
  let pending: FrameRequestCallback | null = null;
  vi.stubGlobal("performance", { now: () => nowMs });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  return {
    advance(dtMs: number) {
      nowMs += dtMs;
      const cb = pending;
      pending = null;
      cb?.(nowMs);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("raf-loop-core fps reporting", () => {
  it("reports an FpsStats with steady ~60fps after the 500ms window", () => {
    const h = harness();
    const reports: FpsStats[] = [];
    attachRafLoopCore({
      render: () => {},
      isActive: () => true,
      reportFps: (s) => reports.push(s),
    });
    // ~1s of 60fps frames (16.67ms each) ⇒ at least one 500ms report.
    for (let i = 0; i < 60; i++) h.advance(1000 / 60);
    expect(reports.length).toBeGreaterThan(0);
    const last = reports[reports.length - 1]!;
    expect(last.instant).toBeCloseTo(60, 0);
    expect(last.averageTotal).toBeCloseTo(60, 0);
    expect(last.min10s).toBeCloseTo(60, 0);
  });

  it("min10s in the reported stats catches a hitch frame", () => {
    const h = harness();
    let last: FpsStats | null = null;
    attachRafLoopCore({
      render: () => {},
      isActive: () => true,
      reportFps: (s) => (last = s),
    });
    for (let i = 0; i < 40; i++) h.advance(1000 / 60);
    h.advance(90); // a 90ms hitch ⇒ ~11fps
    for (let i = 0; i < 40; i++) h.advance(1000 / 60);
    expect(last).not.toBeNull();
    expect(last!.min10s).toBeLessThan(15);
    expect(last!.average10s).toBeGreaterThan(50); // mean barely dented
  });
});
