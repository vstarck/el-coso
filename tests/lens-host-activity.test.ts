/* The ACTIVITY half of the motion gate (`LensHost.isActive`).
 *
 * The host's rAF drains ticks only when `isActive() && isPlaying()`
 * (raf-loop-core), so a lens that must stop when the picture stops — wacha's
 * soundtrack is the first — has to ask both. The hazard this file exists for is
 * not that the predicate is wrong; it is that the lens's copy and the loop's
 * gate DRIFT, which nothing downstream can notice.
 *
 * ⚠ WHAT IS NOT HERE. `mountHost` needs a DOM and an IntersectionObserver and
 * this suite is `environment: "node"`, so the one line that feeds the loop
 * (`isActive: gate` in mount-host) is unreachable from here by construction.
 * `activityGate` was extracted precisely so everything either side of that line
 * IS reachable. The far end is wacha's lab row L19, in a real browser.
 */

import { describe, expect, it } from "vitest";
import { activityGate, makeLensHost } from "@/lib/lens-host/host";
import { windowIsActive } from "@/lib/lens-host/raf-loop-core";
import type { LensHost } from "@/lenses/types";

/** Install a fake `document` for the duration of `fn`. Restores whatever was
 *  there — including "nothing", which is the real state under `node` and is
 *  itself one of the cases below. */
function withDocument(doc: unknown, fn: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const had = "document" in g;
  const prev = g["document"];
  if (doc === undefined) delete g["document"];
  else g["document"] = doc;
  try {
    fn();
  } finally {
    if (had) g["document"] = prev;
    else delete g["document"];
  }
}

const doc = (hasFocus: boolean, hidden: boolean) => ({ hasFocus: () => hasFocus, hidden });

describe("windowIsActive — the app chrome's activity predicate", () => {
  // The truth table, not one row of it: `hasFocus && !hidden` and
  // `hasFocus || !hidden` agree on two of the four worlds, so a two-row gate
  // cannot tell the intended rule from the wrong one.
  it("is true only when the window is focused AND the tab is visible", () => {
    withDocument(doc(true, false), () => expect(windowIsActive()).toBe(true));
    withDocument(doc(false, false), () => expect(windowIsActive()).toBe(false));
    withDocument(doc(true, true), () => expect(windowIsActive()).toBe(false));
    withDocument(doc(false, true), () => expect(windowIsActive()).toBe(false));
  });

  it("defaults to ACTIVE where there is no document at all", () => {
    // Headless / SSR. Defaulting to inactive would freeze every tick in any
    // host without a DOM — the safe default here is the permissive one, and it
    // is why the `node` suite sees `true` unless a test says otherwise.
    withDocument(undefined, () => expect(windowIsActive()).toBe(true));
  });
});

describe("makeLensHost — the store-free host", () => {
  it("defaults isActive to the window predicate, by REFERENCE", () => {
    // Identity, not behaviour: a second implementation that happens to agree
    // today is the drift this seam exists to prevent, and it would pass a
    // behavioural check.
    expect(makeLensHost().isActive).toBe(windowIsActive);
  });

  it("takes an injected predicate and re-reads it LIVE", () => {
    let live = true;
    const host = makeLensHost({ isActive: () => live });
    expect(host.isActive()).toBe(true);
    live = false;
    // A host that captured the value at construction would still say true —
    // an activity model sampled once is a claim about a world a scroll can end.
    expect(host.isActive()).toBe(false);
  });
});

describe("activityGate — one predicate, two readers", () => {
  const base = (): LensHost => makeLensHost({ isActive: () => true });

  it("hands the lens and the loop the SAME function object", () => {
    const gateFn = () => false;
    const { host, gate } = activityGate(base(), gateFn);
    expect(gate).toBe(gateFn);
    expect(host.isActive).toBe(gateFn);
    // The claim in one line: what the lens asks IS what the loop gates on.
    expect(host.isActive).toBe(gate);
  });

  it("OVERRIDES the base host's own predicate — the inequality control", () => {
    // Without this row every assertion above is satisfied by a decoration that
    // does nothing: base already says `true`, so a no-op spread would pass an
    // all-equalities gate. This is the case that must differ.
    const b = base();
    expect(b.isActive()).toBe(true);
    const { host } = activityGate(b, () => false);
    expect(host.isActive()).toBe(false);
    // ...and the base is untouched: decorated, not mutated.
    expect(b.isActive()).toBe(true);
  });

  it("carries every other member through, still bound to the base's state", () => {
    const b = base();
    const { host } = activityGate(b, () => false);
    // A spread of an object whose members read `this` would break here; every
    // LensHost member closes over its own state instead, and this is the row
    // that holds that true.
    expect(host.isPlaying()).toBe(false);
    host.setPlaying(true);
    expect(host.isPlaying()).toBe(true);
    expect(b.isPlaying()).toBe(true);        // one state, not a copy
    expect(host.getSpeedId()).toBe(b.getSpeedId());
  });
});
