import { afterEach, describe, expect, test } from "vitest";
import {
  attachRafLoopCore,
  type FrameProfileSample,
} from "../src/lib/lens-host/raf-loop-core";

/* Drives the core loop with stubbed `requestAnimationFrame` + `performance.now`
 * so we can step exactly one frame and assert what the `profile` seam emits.
 * `isActive` is injected (so the loop registers no focus listeners and never
 * touches `window`/`document`, which the node env lacks). */
function withStubbedRaf(
  body: (step: () => void, setClock: (ms: number) => void, clock: { v: number }) => void,
): void {
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  const realPerf = globalThis.performance;
  const queue: FrameRequestCallback[] = [];
  const clock = { v: 0 };
  // Minimal stubs for the node test env (the loop only reads these two + now).
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    return queue.length;
  };
  globalThis.cancelAnimationFrame = (): void => {};
  // Only `now` is read by the loop; the rest of `Performance` is unused here.
  globalThis.performance = { now: () => clock.v } as Performance;
  const step = (): void => {
    const cb = queue.shift();
    if (cb) cb(clock.v);
  };
  const setClock = (ms: number): void => {
    clock.v = ms;
  };
  try {
    body(step, setClock, clock);
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    globalThis.performance = realPerf;
  }
}

describe("attachRafLoopCore profile seam", () => {
  afterEach(() => {
    /* withStubbedRaf restores globals itself; this is belt-and-suspenders. */
  });

  test("emits tick, render, and frame phases for a playing frame", () => {
    withStubbedRaf((step, setClock, clock) => {
      const samples: FrameProfileSample[] = [];
      const handle = attachRafLoopCore({
        render: () => {
          clock.v += 7; // render costs 7ms of stub-clock
        },
        tick: () => {
          clock.v += 1; // each tick costs 1ms
        },
        isPlaying: () => true,
        isActive: () => true,
        speedMult: () => 1,
        profile: (s) => samples.push(s),
      });
      setClock(100); // dt=100ms (clamped) ⇒ 6 ticks at 1×
      step();
      handle.stop();

      const phases = samples.map((s) => s.phase);
      expect(phases.filter((p) => p === "tick")).toHaveLength(1);
      expect(phases.filter((p) => p === "render")).toHaveLength(1);
      expect(phases.filter((p) => p === "frame")).toHaveLength(1);
      // The tick phase summed all drained ticks (6 × 1ms); render was 7ms;
      // the frame rollup is at least their sum.
      const render = samples.find((s) => s.phase === "render")!;
      const tick = samples.find((s) => s.phase === "tick")!;
      const frame = samples.find((s) => s.phase === "frame")!;
      expect(render.ms).toBe(7);
      expect(tick.ms).toBeGreaterThanOrEqual(6);
      expect(frame.ms).toBeGreaterThanOrEqual(render.ms + tick.ms);
    });
  });

  test("paused frame emits render + frame but no tick", () => {
    withStubbedRaf((step, setClock) => {
      const samples: FrameProfileSample[] = [];
      const handle = attachRafLoopCore({
        render: () => {},
        tick: () => {},
        isPlaying: () => false, // paused
        isActive: () => true,
        profile: (s) => samples.push(s),
      });
      setClock(100);
      step();
      handle.stop();

      const phases = samples.map((s) => s.phase);
      expect(phases).toContain("render");
      expect(phases).toContain("frame");
      expect(phases).not.toContain("tick");
    });
  });

  test("inactive injected host skips render entirely (no render/tick sample)", () => {
    withStubbedRaf((step, setClock) => {
      const samples: FrameProfileSample[] = [];
      const handle = attachRafLoopCore({
        render: () => {},
        tick: () => {},
        isPlaying: () => true,
        isActive: () => false, // off-screen embed: render gated off too
        profile: (s) => samples.push(s),
      });
      setClock(100);
      step();
      handle.stop();

      const phases = samples.map((s) => s.phase);
      expect(phases).not.toContain("tick");
      expect(phases).not.toContain("render");
      expect(phases).toContain("frame"); // the handler still ran (and was cheap)
    });
  });

  test("no profile sink ⇒ loop still runs (no crash, render called)", () => {
    withStubbedRaf((step, setClock) => {
      let rendered = 0;
      const handle = attachRafLoopCore({
        render: () => {
          rendered += 1;
        },
        isActive: () => true,
      });
      setClock(16);
      step();
      handle.stop();
      expect(rendered).toBe(1);
    });
  });
});
