/* Console command registry (spec/26) — assembles the live `CommandSource` the
 * terminal shell consumes from a mounted lens + its host. It flattens the three
 * embed-SDK control tiers (spec/25 — transport verbs · tunables · named
 * commands) into one typeable command namespace:
 *
 *   built-ins (transport, `set`/`get` from `Lens.tunables`, `describe`, …)
 *   ∪  the substrate's own commands (`Lens.commands` / `MountedLens.commands()`)
 *
 * The substrate OVERRIDES a built-in by declaring a command of the same name (a
 * collision warns once, never a silent shadow). Availability is queried LIVE: a
 * substrate that returns a state-dependent `MountedLens.commands()` is reflected
 * the next keystroke. Every built-in dispatch is wrapped in the substrate's
 * optional `interceptCommand` middleware (validate / clamp / override `set`);
 * the substrate's own commands are not wrapped — it already owns them.
 *
 * `help` is owned by the shell core (every terminal wants it); `clear` is not a
 * command at all — the core clears the screen on Ctrl-L, leaving the name free.
 */

import type { TickedState } from "@/history";
import type {
  CommandDescriptor,
  CommandSource,
} from "@/lib/terminal";
import type {
  EmbedCommandSpec,
  Lens,
  LensHost,
  LensTunable,
  MountedLens,
  TunableValue,
} from "./types";

export type ConsoleRegistryArgs<S extends TickedState, C, I, P> = {
  // Declared command surface + tunables/speeds/features the built-ins read.
  lens: Lens<S, C, I, P>;
  // Live command surface + transport + tunable get/set the built-ins act on.
  mounted: MountedLens<S>;
  // Transport intent (play/pause/speed) the built-ins drive.
  host: LensHost;
  // `describe` flavor — the lens name is always shown; a description if given.
  meta?: { description?: string };
  // Optional `snapshot` action (absent ⇒ the command is not offered).
  onSnapshot?: () => void;
  // Optional `fps` readout (absent ⇒ the command is not offered).
  fps?: () => string;
};

type BuiltIn = {
  descriptor: CommandDescriptor;
  // Run the default behavior. Return text to print; throw to surface an error.
  handler: (args: unknown[]) => string | void;
};

// Coerce a raw `set <tunable> <value>` token to the tunable's declared type,
// throwing (never silently mangling) on a value the type can't accept.
function coerceTunableValue(t: LensTunable, raw: unknown): TunableValue {
  const s = String(raw ?? "");
  switch (t.type) {
    case "float":
    case "int": {
      const n = Number(s);
      if (!Number.isFinite(n)) {
        throw new Error(`${t.id}: expected a number, got "${s}"`);
      }
      return t.type === "int" ? Math.round(n) : n;
    }
    case "bool":
      if (/^(1|true|on|yes|y)$/i.test(s)) return true;
      if (/^(0|false|off|no|n)$/i.test(s)) return false;
      throw new Error(`${t.id}: expected true/false, got "${s}"`);
    case "enum":
      if (!t.options.includes(s)) {
        throw new Error(`${t.id}: expected one of ${t.options.join(" / ")}, got "${s}"`);
      }
      return s;
  }
}

export function buildConsoleRegistry<S extends TickedState, C, I, P>(
  a: ConsoleRegistryArgs<S, C, I, P>,
): CommandSource {
  const { lens, mounted, host } = a;
  const tunables = lens.tunables;
  const ticks = mounted.tick !== undefined || (lens.features ?? []).includes("AUTOPLAY");

  function tunableById(id: string): LensTunable {
    const t = tunables.find((x) => x.id === id);
    if (!t) {
      throw new Error(`unknown tunable: ${id} — try ${tunables.map((x) => x.id).join(" / ")}`);
    }
    return t;
  }

  // The built-in catalog. Each entry is present only when its backing surface
  // exists — a render-only lens gets no transport, a tunable-less lens no `set`.
  const catalog: Array<{ present: boolean; built: BuiltIn }> = [
    {
      present: ticks,
      built: {
        descriptor: { name: "play", label: "resume" },
        handler: () => {
          host.setPlaying(true);
        },
      },
    },
    {
      present: ticks,
      built: {
        descriptor: { name: "pause", label: "pause" },
        handler: () => {
          host.setPlaying(false);
        },
      },
    },
    {
      present: ticks,
      built: {
        descriptor: { name: "step", label: "advance N ticks", args: [{ name: "n", type: "number" }] },
        handler: (args) => {
          const n = Math.max(1, Math.floor(Number(args[0] ?? 1)));
          for (let i = 0; i < n; i++) mounted.step();
        },
      },
    },
    {
      present: lens.speeds.length > 0,
      built: {
        descriptor: { name: "speed", label: "set speed preset", args: [{ name: "id", type: "string" }] },
        handler: (args) => {
          const id = String(args[0] ?? "");
          if (!lens.speeds.some((s) => s.id === id)) {
            throw new Error(`unknown speed: ${id} — try ${lens.speeds.map((s) => s.id).join(" / ")}`);
          }
          host.setSpeedId(id);
          return `speed ${id}`;
        },
      },
    },
    {
      present: tunables.length > 0,
      built: {
        descriptor: {
          name: "set",
          label: "set a tunable",
          args: [
            { name: "tunable", type: "string" },
            { name: "value", type: "string" },
          ],
        },
        handler: (args) => {
          const id = String(args[0] ?? "");
          const t = tunableById(id);
          const value = coerceTunableValue(t, args[1]);
          mounted.setTunable(t.path, value);
          return `${id} = ${String(value)}`;
        },
      },
    },
    {
      present: tunables.length > 0,
      built: {
        descriptor: { name: "get", label: "read a tunable", args: [{ name: "tunable", type: "string" }] },
        handler: (args) => {
          const id = String(args[0] ?? "");
          const t = tunableById(id);
          const v = mounted.getTunable(t.path);
          return `${id} = ${v === undefined ? "(unset)" : String(v)}`;
        },
      },
    },
    {
      present: true,
      built: {
        descriptor: { name: "describe", label: "about this substrate" },
        handler: () => (a.meta?.description ? `${lens.name} — ${a.meta.description}` : lens.name),
      },
    },
    {
      present: a.onSnapshot !== undefined,
      built: {
        descriptor: { name: "snapshot", label: "capture a still" },
        handler: () => {
          a.onSnapshot!();
          return "snapshot taken";
        },
      },
    },
    {
      present: a.fps !== undefined,
      built: {
        descriptor: { name: "fps", label: "frame rate" },
        handler: () => a.fps!(),
      },
    },
  ];

  const builtins = catalog.filter((c) => c.present).map((c) => c.built);
  const builtinByName: Record<string, BuiltIn> = {};
  for (const b of builtins) builtinByName[b.descriptor.name] = b;

  const warned = new Set<string>(); // collision warnings fire once per name

  function substrateCommands(): ReadonlyArray<EmbedCommandSpec> {
    return mounted.commands ? mounted.commands() : lens.commands ?? [];
  }

  function list(): ReadonlyArray<CommandDescriptor> {
    const substrate = substrateCommands();
    const overridden = new Set(substrate.map((c) => c.name));
    for (const name of overridden) {
      if (builtinByName[name] && !warned.has(name)) {
        warned.add(name);
        console.warn(
          `[console] ${lens.name} command "${name}" overrides the built-in of the same name`,
        );
      }
    }
    const keptBuiltins = builtins
      .filter((b) => !overridden.has(b.descriptor.name))
      .map((b) => b.descriptor);
    return [...keptBuiltins, ...substrate];
  }

  function dispatch(name: string, args: unknown[]): string | void {
    // The substrate overrides a built-in of the same name; its own commands are
    // never wrapped by the interceptor (it owns them).
    if (substrateCommands().some((c) => c.name === name)) {
      if (!mounted.command) throw new Error(`${lens.name} accepts no commands`);
      return mounted.command(name, args);
    }
    const builtin = builtinByName[name];
    if (!builtin) throw new Error(`unknown command: ${name}`);
    const run = (override: unknown[] = args) => builtin.handler(override);
    return mounted.interceptCommand
      ? mounted.interceptCommand(name, args, run)
      : run();
  }

  return { list, dispatch };
}
