import { describe, expect, it } from "vitest";
import { buildConsoleCss } from "../src/lib/terminal/console";
import { THEMES } from "../src/lib/terminal/theme";
import {
  buildHelpText,
  coerceArgs,
  type CommandDescriptor,
} from "../src/lib/terminal/shell";

// The console widget's DOM/key handling needs a browser, but its load-bearing
// logic — arg type-coercion and the help/CSS string builders — is pure and
// worth pinning. These mirror what `withConsole` feeds in from a lens's
// `EmbedCommandSpec[]`.
const SPAWN: CommandDescriptor = {
  name: "spawn",
  args: [
    { name: "pattern", type: "string" },
    { name: "x", type: "number" },
    { name: "y", type: "number" },
  ],
};

describe("coerceArgs", () => {
  it("coerces tokens to the declared arg types", () => {
    expect(coerceArgs(SPAWN, ["glider", "5", "12"])).toEqual(["glider", 5, 12]);
  });

  it("coerces bool tokens both ways", () => {
    const cmd: CommandDescriptor = { name: "auto", args: [{ name: "on", type: "bool" }] };
    expect(coerceArgs(cmd, ["on"])).toEqual([true]);
    expect(coerceArgs(cmd, ["no"])).toEqual([false]);
  });

  it("throws on a malformed number rather than passing NaN", () => {
    expect(() => coerceArgs(SPAWN, ["glider", "abc", "1"])).toThrow(/expected a number/);
  });

  it("passes tokens past the declared specs through as strings", () => {
    const cmd: CommandDescriptor = { name: "echo" };
    expect(coerceArgs(cmd, ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("buildHelpText", () => {
  it("lists commands with arg signatures plus the built-ins", () => {
    const text = buildHelpText([SPAWN, { name: "clear", label: "kill cells" }]);
    expect(text).toContain("spawn <pattern> <x> <y>");
    expect(text).toContain("help");
    expect(text).toContain("clear");
  });
});

describe("buildConsoleCss", () => {
  it("scopes class names by prefix so two consoles don't collide", () => {
    const css = buildConsoleCss("conway-console");
    expect(css).toContain(".conway-console-con-panel");
    expect(css).not.toContain(".-con-panel");
  });
});

// ── themed scrollbar (S203) ──────────────────────────────────────────────────
//
// The log's scrollbar used to be the browser default — a bright OS bar over the
// phosphor panel. These pin the two claims that matter: it is drawn from the
// THEME (so it re-tints with the palette rather than freezing one green), and it
// is SCOPED to the log (a bare `::-webkit-scrollbar` would repaint the host
// page's scrollbars, and the console mounts inside somebody else's page).

describe("buildConsoleCss — scrollbar", () => {
  it("styles the log's scrollbar in both engines", () => {
    const css = buildConsoleCss("wacha-console");
    expect(css).toContain(".wacha-console-con-log::-webkit-scrollbar");
    expect(css).toContain(".wacha-console-con-log::-webkit-scrollbar-thumb");
    expect(css).toContain("scrollbar-width: thin");
  });

  // S203 measured that these two — not the ::-webkit- block — are what Chrome
  // and Firefox actually render. They were untested while the fallback was
  // gated, which is the wrong way round.
  it("themes the standard scrollbar properties, which are what render", () => {
    const css = buildConsoleCss("wacha-console");
    const log = /\.wacha-console-con-log \{([^}]*)\}/.exec(css);
    expect(log).not.toBeNull();
    expect(log![1]).toContain("scrollbar-width: thin");
    expect(log![1]).toContain(`scrollbar-color: ${THEMES.default!.text}`);
  });

  it("draws the FALLBACK thumb from the theme text colour, not a fresh constant", () => {
    const css = buildConsoleCss("wacha-console");
    const thumb = /-webkit-scrollbar-thumb \{([^}]*)\}/.exec(css);
    expect(thumb).not.toBeNull();
    expect(thumb![1]).toContain(THEMES.default!.text);
  });

  // Control: every scrollbar selector must carry the log's scoped class. A rule
  // that escapes the panel is the failure this styling can actually cause.
  it("scopes every scrollbar rule to the log — none leak to the host page", () => {
    const css = buildConsoleCss("wacha-console");
    const rules = css.match(/^[^{}\n]*::-webkit-scrollbar[^{}\n]*(?=\{)/gm) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const sel of rules) expect(sel).toContain(".wacha-console-con-log");
  });
});
