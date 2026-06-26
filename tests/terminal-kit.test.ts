import { describe, it, expect } from "vitest";
import {
  buildCrtCss,
  buildTerminalCss,
  THEMES,
  DEFAULT_THEME,
  CRT_DEFAULT_FONT_PX,
} from "@/lib/terminal";

// The terminal kit's whole reason to exist is multi-sandbox isolation: two
// terminal substrates on one page must not share class names / keyframes / CSS
// vars. These tests lock that the generated CSS is fully namespaced by the
// caller's `classPrefix` — the collision the extraction was built to kill.

describe("terminal kit — CRT css scoping", () => {
  it("namespaces every class, keyframe and var under the prefix", () => {
    const css = buildCrtCss("tts", 640);
    expect(css).toContain(".tts-crt-screen");
    expect(css).toContain(".tts-crt-text");
    expect(css).toContain(".tts-crt-scanlines");
    expect(css).toContain("@keyframes tts-crt-wobble");
    expect(css).toContain("@keyframes tts-crt-flicker");
    expect(css).toContain("var(--tts-glow)");
    expect(css).toContain("width: 640px");
  });

  it("two prefixes share no selectors (the collision fix)", () => {
    const a = buildCrtCss("vroom", 640);
    expect(a).toContain(".vroom-crt-screen");
    expect(a).not.toContain("tts-crt"); // no leakage of the other substrate's names
    expect(a).not.toContain("--tts-glow");
  });

  it("changing the prefix is a pure rename — nothing else leaks", () => {
    // If the only thing that varies with the prefix is the prefix token, then
    // renaming it in one output reproduces the other exactly. This catches any
    // hardcoded name we forgot to scope.
    const alpha = buildCrtCss("alpha", 480);
    const beta = buildCrtCss("beta", 480);
    expect(alpha.replaceAll("alpha", "beta")).toBe(beta);
  });
});

describe("terminal kit — terminal css scoping", () => {
  it("namespaces the cursor class + blink keyframe", () => {
    const css = buildTerminalCss("tts");
    expect(css).toContain(".tts-term-cursor");
    expect(css).toContain("@keyframes tts-term-blink");
  });

  it("two prefixes share no selectors", () => {
    const css = buildTerminalCss("vroom");
    expect(css).toContain("vroom-term-blink");
    expect(css).not.toContain("tts-term");
  });
});

describe("terminal kit — default themes", () => {
  it("ships a default palette set with a resolvable default", () => {
    expect(Object.keys(THEMES)).toEqual(["default", "boomer-blue", "modern"]);
    expect(THEMES[DEFAULT_THEME]).toBeDefined();
    // CRT on for the phosphor themes, off for the modern editor look.
    expect(THEMES["default"]!.crt).toBe(true);
    expect(THEMES["modern"]!.crt).toBe(false);
  });

  it("exposes a sane default font size", () => {
    expect(CRT_DEFAULT_FONT_PX).toBeGreaterThan(0);
  });
});
