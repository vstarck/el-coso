import { describe, expect, test, vi } from "vitest";
import { currentNotices, dismissNotice, firstBuildable, pushNotice, subscribeNotices } from "@/app/notices";

// app/notices.ts — the boot fallback and the notice store. The session's wiring is checked at the far end, in a
// browser without a GPU (a refused substrate must leave the app up and say why).

describe("firstBuildable", () => {
  // catches: a boot that dies on the first refusal (the S273 failure), or one that hides it
  test("returns the first candidate that builds, with every refusal before it, in order", () => {
    const build = (c: string) => { if (c.startsWith("x")) throw new Error(`no ${c}`); return `frame:${c}`; };
    const r = firstBuildable(["x1", "x2", "ok", "later"], build);
    expect(r.candidate).toBe("ok");
    expect(r.frame).toBe("frame:ok");
    expect(r.refused.map((f) => [f.candidate, (f.error as Error).message])).toEqual([["x1", "no x1"], ["x2", "no x2"]]);
  });
  test("the first candidate building means nothing was refused", () => {
    expect(firstBuildable(["a", "b"], (c) => c).refused).toEqual([]);
  });
  // catches: a fallback that, with nothing buildable, returns undefined instead of saying so
  test("nothing buildable throws, naming every cause", () => {
    expect(() => firstBuildable(["x1", "x2"], (c) => { throw new Error(`no ${c}`); })).toThrow(/no substrate could be opened \(2 tried\): no x1 · no x2/);
  });
});

describe("notices", () => {
  test("a pushed notice is listed, logged, announced, and gone once dismissed", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const off = subscribeNotices(() => { calls++; });
    pushNotice("X could not open", "because");
    const n = currentNotices().at(-1)!;
    expect(n.title).toBe("X could not open");
    expect(err).toHaveBeenCalledWith("[el-coso] X could not open: because");
    dismissNotice(n.id);
    expect(currentNotices().find((m) => m.id === n.id)).toBeUndefined();
    expect(calls).toBe(2);
    off();
    err.mockRestore();
  });
});
