import { describe, expect, it } from "vitest";
import { enumDisplay } from "../src/app/components/chrome/enum-display";
import type { Rule } from "../src/lib/types";

const en = (options: string[], display?: "segmented" | "list"): Extract<Rule, { type: "enum" }> => ({
  id: "x", group: "g", label: "x", type: "enum", options,
  ...(display === undefined ? {} : { display }),
});

// The rail is React and this suite is `environment: "node"` with no jsdom, so the
// rendering itself is unreachable. What is gateable — and what actually carries the
// behaviour — is the decision.
describe("enumDisplay", () => {
  it("paints more than two options as a list, two or fewer as a segmented group", () => {
    expect(enumDisplay(en(["a", "b", "c"]))).toBe("list");
    expect(enumDisplay(en(["a", "b"]))).toBe("segmented");
    expect(enumDisplay(en(["a"]))).toBe("segmented");
    // the boundary, from both sides — an off-by-one here is a silent styling change
    expect(enumDisplay(en(["a", "b", "c", "d", "e"]))).toBe("list");
  });

  it("an EXPLICIT display always wins, in both directions", () => {
    // this is the half that makes the change safe: a substrate that stated its intent
    // keeps exactly the behaviour it had, whichever way it stated it
    expect(enumDisplay(en(["a", "b", "c", "d"], "segmented"))).toBe("segmented");
    expect(enumDisplay(en(["a", "b"], "list"))).toBe("list");
  });

  it("the empty option set does not throw and does not become a list", () => {
    // reachable: `options: [...SOME_IDS]` where the source array is empty at boot
    expect(enumDisplay(en([]))).toBe("segmented");
  });
});
