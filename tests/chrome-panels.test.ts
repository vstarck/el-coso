import { describe, expect, it } from "vitest";
import { ALL_PANELS, resolveChromePanels } from "../src/app/store";

// Per-substrate chrome config resolves into two boolean records: which panels
// are available (drives whether App renders the panel/stub at all) and which
// are open at boot. Two positive-statement axes; omission falls back to the
// legacy all-available / all-open behavior.
describe("resolveChromePanels", () => {
  it("omitted config ⇒ every panel available and open (legacy default)", () => {
    const { panels, availablePanels } = resolveChromePanels();
    for (const id of ALL_PANELS) {
      expect(panels[id]).toBe(true);
      expect(availablePanels[id]).toBe(true);
    }
  });

  it("defaultOpen restricts what's open but leaves all panels available", () => {
    // A substrate config: every panel available, only the topbar open.
    const { panels, availablePanels } = resolveChromePanels({
      defaultOpen: ["toolbar"],
    });
    expect(panels).toEqual({
      toolbar: true,
      inspector: false,
      rules: false,
      timeline: false,
    });
    for (const id of ALL_PANELS) expect(availablePanels[id]).toBe(true);
  });

  it("available hides panels the substrate doesn't offer", () => {
    const { panels, availablePanels } = resolveChromePanels({
      available: ["toolbar", "timeline"],
    });
    expect(availablePanels).toEqual({
      toolbar: true,
      inspector: false,
      rules: false,
      timeline: true,
    });
    // defaultOpen omitted ⇒ open == available.
    expect(panels).toEqual(availablePanels);
  });

  it("an unavailable panel is never open, even if defaultOpen lists it", () => {
    const { panels } = resolveChromePanels({
      available: ["toolbar"],
      defaultOpen: ["toolbar", "rules"],
    });
    expect(panels.rules).toBe(false);
    expect(panels.toolbar).toBe(true);
  });
});
