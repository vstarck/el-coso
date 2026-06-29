import { describe, expect, it, vi } from "vitest";
import {
  createShell,
  type CommandSource,
  type Shell,
} from "../src/lib/terminal/shell";
import { buildConsoleRegistry } from "../src/lenses/console-registry";
import type {
  Lens,
  LensHost,
  LensTunable,
  MountedLens,
  TunableValue,
} from "../src/lenses/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function typeLine(sh: Shell, text: string): void {
  for (const ch of text) sh.handle({ kind: "insert", ch });
  sh.handle({ kind: "key", key: "enter" });
}

function scrollbackText(sh: Shell): string {
  return sh
    .view()
    .scrollback.map((l) => l.spans.map((s) => s.text).join(""))
    .join("\n");
}

// ── the render-free core ─────────────────────────────────────────────────────

describe("createShell (render-free core)", () => {
  function recordingSource(): { source: CommandSource; calls: Array<[string, unknown[]]> } {
    const calls: Array<[string, unknown[]]> = [];
    const source: CommandSource = {
      list: () => [{ name: "foo", label: "do foo", args: [{ name: "n", type: "number" }] }],
      dispatch: (name, args) => {
        calls.push([name, args]);
        return `ran ${name}`;
      },
    };
    return { source, calls };
  }

  it("echoes, coerces args, and dispatches a known command", () => {
    const { source, calls } = recordingSource();
    const sh = createShell({ source });
    typeLine(sh, "foo 5");
    expect(calls).toEqual([["foo", [5]]]);
    const text = scrollbackText(sh);
    expect(text).toContain("foo 5"); // the echoed line (prompt + input)
    expect(text).toContain("ran foo"); // the dispatch result
  });

  it("prints an unknown-command line without dispatching", () => {
    const { source, calls } = recordingSource();
    const sh = createShell({ source });
    typeLine(sh, "bar");
    expect(calls).toEqual([]);
    expect(scrollbackText(sh)).toContain("unknown command: bar");
  });

  it("surfaces a dispatch throw as an error line, never swallowed", () => {
    const source: CommandSource = {
      list: () => [{ name: "boom" }],
      dispatch: () => {
        throw new Error("kaboom");
      },
    };
    const sh = createShell({ source });
    typeLine(sh, "boom");
    expect(scrollbackText(sh)).toContain("error: kaboom");
  });

  it("owns `help` and lists the source commands (source can override it)", () => {
    const { source } = recordingSource();
    const sh = createShell({ source });
    typeLine(sh, "help");
    const text = scrollbackText(sh);
    expect(text).toContain("commands:");
    expect(text).toContain("foo");
    expect(text).toContain("help");
  });

  it("recalls history with ↑", () => {
    const { source } = recordingSource();
    const sh = createShell({ source });
    typeLine(sh, "foo 1");
    sh.handle({ kind: "key", key: "history-prev" });
    expect(sh.view().edit.before).toBe("foo 1");
  });

  it("Tab-completes a unique command name", () => {
    const { source } = recordingSource();
    const sh = createShell({ source });
    sh.handle({ kind: "insert", ch: "f" });
    sh.handle({ kind: "key", key: "tab" });
    expect(sh.view().edit.before).toBe("foo ");
  });

  it("Ctrl-L (clear-screen) empties scrollback; there is no `clear` command", () => {
    const { source, calls } = recordingSource();
    const sh = createShell({ source });
    sh.print("a line");
    expect(scrollbackText(sh)).not.toBe("");
    sh.handle({ kind: "key", key: "clear-screen" });
    expect(sh.view().scrollback).toHaveLength(0);
    // `clear` is just an unknown command (the core never reserves it).
    typeLine(sh, "clear");
    expect(calls).toEqual([]);
    expect(scrollbackText(sh)).toContain("unknown command: clear");
  });

  it("clearOnSubmit wipes prior output so only the latest command shows", () => {
    const { source } = recordingSource();
    const sh = createShell({ source, clearOnSubmit: true });
    typeLine(sh, "foo 1");
    typeLine(sh, "foo 2");
    const text = scrollbackText(sh);
    expect(text).toContain("foo 2"); // the latest echo
    expect(text).not.toContain("foo 1"); // the prior transcript was cleared
  });

  it("with a pinned help banner, typing `help` does not duplicate the list", () => {
    const { source } = recordingSource();
    const sh = createShell({ source, banner: "commands:\n  foo", clearOnSubmit: true });
    sh.activate();
    typeLine(sh, "help");
    const text = scrollbackText(sh);
    // Exactly one "commands:" — the pinned header, no duplicate from the command.
    expect(text.split("commands:").length - 1).toBe(1);
  });

  it("the banner is a pinned header — it survives clearOnSubmit", () => {
    const { source } = recordingSource();
    const sh = createShell({ source, banner: "INTRO", clearOnSubmit: true });
    sh.activate();
    typeLine(sh, "foo 1");
    typeLine(sh, "foo 2");
    const text = scrollbackText(sh);
    expect(text).toContain("INTRO"); // header kept across clears
    expect(text).toContain("foo 2"); // latest transient transcript
    expect(text).not.toContain("foo 1"); // prior transient cleared
  });

  it("queries the source live — a changed list() is reflected next keystroke", () => {
    let dynamic = false;
    const source: CommandSource = {
      list: () => (dynamic ? [{ name: "boom" }] : []),
      dispatch: () => "ran boom",
    };
    const sh = createShell({ source });
    typeLine(sh, "boom");
    expect(scrollbackText(sh)).toContain("unknown command: boom");
    dynamic = true;
    typeLine(sh, "boom");
    expect(scrollbackText(sh)).toContain("ran boom");
  });
});

// ── the command registry ─────────────────────────────────────────────────────

type Harness = {
  reg: ReturnType<typeof buildConsoleRegistry>;
  store: Record<string, TunableValue>;
  playing: { v: boolean };
  speedId: { v: string };
  steps: { n: number };
};

function makeRegistry(overrides?: Partial<MountedLens<never>>): Harness {
  const store: Record<string, TunableValue> = { size: 4, mode: "a" };
  const playing = { v: false };
  const speedId = { v: "1x" };
  const steps = { n: 0 };

  const tunables: LensTunable[] = [
    { id: "size", group: "L", label: "Size", type: "int", min: 1, max: 10, step: 1, target: "lens", path: ["size"] },
    { id: "mode", group: "L", label: "Mode", type: "enum", options: ["a", "b"], target: "lens", path: ["mode"] },
  ];

  const host = {
    isPlaying: () => playing.v,
    setPlaying: (p: boolean) => {
      playing.v = p;
    },
    togglePlaying: () => {},
    getSpeedId: () => speedId.v,
    setSpeedId: (id: string) => {
      speedId.v = id;
    },
    getPlayheadTick: () => 0,
    setPlayheadTick: () => {},
    getHistoryVersion: () => 0,
    bumpHistoryVersion: () => {},
    subscribeHead: () => () => {},
  } satisfies LensHost;

  const mounted = {
    tick: () => {},
    step: () => {
      steps.n++;
    },
    getTunable: (path: string[]) => store[path[0]!],
    setTunable: (path: string[], value: TunableValue) => {
      store[path[0]!] = value;
    },
    ...overrides,
  } as unknown as MountedLens<never>;

  const lens = {
    id: "x",
    name: "X",
    tunables,
    speeds: [
      { id: "1x", label: "1x", mult: 1, isDefault: true },
      { id: "2x", label: "2x", mult: 2 },
    ],
    features: ["AUTOPLAY"],
    commands: [],
  } as unknown as Lens<never, unknown, unknown, unknown>;

  const reg = buildConsoleRegistry({ lens, mounted, host, meta: { description: "a test lens" } });
  return { reg, store, playing, speedId, steps };
}

describe("buildConsoleRegistry", () => {
  it("offers transport + set/get + describe as built-ins", () => {
    const { reg } = makeRegistry();
    const names = reg.list().map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["play", "pause", "step", "speed", "set", "get", "describe"]));
  });

  it("`set` writes a tunable, coercing + validating per its type", () => {
    const { reg, store } = makeRegistry();
    expect(reg.dispatch("set", ["size", "7"])).toBe("size = 7");
    expect(store.size).toBe(7);
    expect(reg.dispatch("set", ["mode", "b"])).toBe("mode = b");
    expect(store.mode).toBe("b");
    expect(() => reg.dispatch("set", ["mode", "z"])).toThrow(/expected one of/);
    expect(() => reg.dispatch("set", ["nope", "1"])).toThrow(/unknown tunable/);
  });

  it("transport built-ins drive the host", () => {
    const { reg, playing, speedId, steps } = makeRegistry();
    reg.dispatch("play", []);
    expect(playing.v).toBe(true);
    reg.dispatch("pause", []);
    expect(playing.v).toBe(false);
    reg.dispatch("step", [3]);
    expect(steps.n).toBe(3);
    reg.dispatch("speed", ["2x"]);
    expect(speedId.v).toBe("2x");
    expect(() => reg.dispatch("speed", ["9x"])).toThrow(/unknown speed/);
  });

  it("a substrate command overrides a built-in of the same name (warn once)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: Array<[string, unknown[]]> = [];
    const { reg, playing } = makeRegistry({
      commands: () => [{ name: "play", label: "custom play" }],
      command: (name, args) => {
        calls.push([name, args]);
      },
    });
    reg.list();
    reg.list();
    expect(warn).toHaveBeenCalledTimes(1); // once per colliding name
    reg.dispatch("play", []);
    expect(calls).toEqual([["play", []]]); // routed to the substrate, not the built-in
    expect(playing.v).toBe(false); // the built-in did NOT run
    warn.mockRestore();
  });

  it("runs interceptCommand around built-ins — clamp + reject", () => {
    const { reg, store } = makeRegistry({
      interceptCommand: (name, args, next) => {
        if (name === "set" && args[0] === "size") {
          const v = Math.min(5, Number(args[1]));
          if (Number(args[1]) < 0) throw new Error("size must be ≥ 0");
          return next(["size", v]);
        }
        return next();
      },
    });
    reg.dispatch("set", ["size", "99"]);
    expect(store.size).toBe(5); // clamped via next([...])
    expect(() => reg.dispatch("set", ["size", "-1"])).toThrow(/≥ 0/);
    expect(store.size).toBe(5); // rejected write left the tunable untouched
  });

  it("reads the live command set (dynamic availability)", () => {
    let armed = false;
    const { reg } = makeRegistry({ commands: () => (armed ? [{ name: "boom" }] : []) });
    expect(reg.list().map((c) => c.name)).not.toContain("boom");
    armed = true;
    expect(reg.list().map((c) => c.name)).toContain("boom");
  });
});
