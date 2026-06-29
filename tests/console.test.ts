import { describe, expect, it } from "vitest";
import { buildConsoleCss } from "../src/lib/terminal/console";
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
