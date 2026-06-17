import { describe, it, expect } from "vitest";
import {
  SUBSTRATES,
  SUBSTRATE_BY_ID,
  registerSubstrates,
  type SubstrateModule,
} from "@/app/substrates";

// Guards the glob-discovery roster + the `registerSubstrates` injection seam
// (an external overlay's entry point). Deliberately does NOT assert the exact
// roster contents — that set is curated — only the stable mechanics.

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeModule(id: string): SubstrateModule {
  return {
    bundle: {} as any,
    adapter: {} as any,
    lenses: {},
    defaultLensId: "x",
    parseLevel: (j) => j,
    puzzles: [{ id: `${id}-0`, description: "" }],
    meta: { id, name: id, defaultPuzzle: `${id}-0`, keyframePeriod: 100 },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("substrate registry — glob discovery + injection seam", () => {
  it("discovers a populated roster", () => {
    expect(SUBSTRATES.length).toBeGreaterThan(0);
    for (const s of SUBSTRATES) expect(typeof s.id).toBe("string");
    // An id not in the roster resolves to nothing.
    expect(SUBSTRATE_BY_ID["__not-a-substrate__"]).toBeUndefined();
  });

  it("projects meta.chrome / meta.renderSize through to the entry", () => {
    registerSubstrates([
      {
        ...fakeModule("zzz-chrome"),
        meta: {
          id: "zzz-chrome",
          name: "zzz-chrome",
          defaultPuzzle: "zzz-chrome-0",
          keyframePeriod: 100,
          chrome: { defaultOpen: ["toolbar"] },
          renderSize: { width: 320, height: 240 },
        },
      },
    ]);
    const e = SUBSTRATE_BY_ID["zzz-chrome"]!;
    expect(e.chrome).toEqual({ defaultOpen: ["toolbar"] });
    expect(e.renderSize).toEqual({ width: 320, height: 240 });
  });

  it("registerSubstrates appends, projects the barrel, and dedups by id", () => {
    const before = SUBSTRATES.length;
    registerSubstrates([fakeModule("zzz-overlay")]);
    expect(SUBSTRATES.length).toBe(before + 1);

    const entry = SUBSTRATE_BY_ID["zzz-overlay"]!;
    expect(entry.name).toBe("zzz-overlay");
    expect(entry.puzzles[0]!.id).toBe("zzz-overlay-0");
    expect(entry.chrome).toBeUndefined(); // conditional-spread omits it
    expect(entry.renderSize).toBeUndefined();
    // Unlisted id sorts to the end (after the ORDER-pinned roster).
    expect(SUBSTRATES[SUBSTRATES.length - 1]!.id).toBe("zzz-overlay");

    // Re-registering the same id is ignored (first registration wins).
    registerSubstrates([fakeModule("zzz-overlay")]);
    expect(SUBSTRATES.length).toBe(before + 1);
  });
});
