import { describe, expect, it } from "vitest";
import { ALL_PANELS, resolveChromePanels } from "../src/app/store";

// Per-substrate chrome config resolves into two boolean records: which panels
// are available (drives whether App renders the panel/stub at all) and which
// are open at boot. Two positive-statement axes. When defaultOpen is omitted,
// open falls back to DEFAULT_OPEN_PANELS (toolbar + rules); the user's
// persisted toggles overlay the result.
describe("resolveChromePanels", () => {
  it("omitted config ⇒ every panel available; toolbar + rules open, timeline + inspector closed", () => {
    const { panels, availablePanels } = resolveChromePanels();
    for (const id of ALL_PANELS) expect(availablePanels[id]).toBe(true);
    expect(panels).toEqual({
      toolbar: true,
      rules: true,
      inspector: false,
      timeline: false,
    });
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
    // defaultOpen omitted ⇒ open == DEFAULT_OPEN_PANELS ∩ available.
    // rules isn't available, timeline isn't a default ⇒ only toolbar open.
    expect(panels).toEqual({
      toolbar: true,
      inspector: false,
      rules: false,
      timeline: false,
    });
  });

  it("an unavailable panel is never open, even if defaultOpen lists it", () => {
    const { panels } = resolveChromePanels({
      available: ["toolbar"],
      defaultOpen: ["toolbar", "rules"],
    });
    expect(panels.rules).toBe(false);
    expect(panels.toolbar).toBe(true);
  });

  it("persisted user toggles overlay the substrate defaults", () => {
    // User has explicitly opened the timeline and closed the rules rail; both
    // override the omitted-config defaults.
    const { panels } = resolveChromePanels(undefined, {
      timeline: true,
      rules: false,
    });
    expect(panels).toEqual({
      toolbar: true,
      rules: false,
      inspector: false,
      timeline: true,
    });
  });

  it("a persisted toggle for an unavailable panel is ignored", () => {
    const { panels } = resolveChromePanels(
      { available: ["toolbar"] },
      { timeline: true },
    );
    expect(panels.timeline).toBe(false);
  });
});
