/* withConsole — wrap any lens so it grows a guake-style drop-down command
 * console (press backtick to toggle). It's a thin decorator, NOT a composition
 * layer or a contract change: it mounts the base lens normally, adds the
 * console overlay inside the same container, and forwards every MountedLens
 * method to the base. Because it's pure lens-tier it works identically in the
 * app, embeds, and bare.html.
 *
 * The console is a text front-end to the lens's command surface assembled by
 * the command registry (spec/26): universal built-ins (transport, `set`/`get`
 * from the lens's tunables, `describe`) come for free, and the substrate's own
 * `commands` (spec/25) layer on top, overriding any built-in of the same name.
 * So a substrate "implements the console" exactly the way it implements embed
 * commands — declare `commands` + handle `command(name, args)` — and a lens with
 * no commands of its own still gets a useful REPL (built-ins + `help`).
 */

import type { TickedState } from "@/history";
import { mountConsole, type CommandDescriptor } from "@/lib/terminal";
import { buildConsoleRegistry } from "./console-registry";
import type { Lens, LensMountArgs, LensTunable, MountedLens } from "./types";

// The console's open/closed state, exposed as a bool tunable so a host toolbar
// can READ it (the snapshot in spec/25) and DRIVE it (setTunable) — e.g. a
// portfolio's `>` terminal toggle. Reuses the tunable channel rather than a
// bespoke console-control message: toggling = set, knowing-state = get +
// subscribe, all already plumbed to the host. Every console-decorated lens gets
// it for free.
const CONSOLE_OPEN_PATH = "console_open";
const CONSOLE_OPEN_TUNABLE: LensTunable = {
  id: CONSOLE_OPEN_PATH,
  group: "Console",
  label: "Terminal",
  type: "bool",
  target: "lens",
  path: [CONSOLE_OPEN_PATH],
};

export type WithConsoleOptions = {
  // Class-name namespace for the console's scoped CSS. Defaults to
  // `<lens id>-console`; override only if two console lenses share a page
  // under the same id.
  classPrefix?: string;
  // Key that toggles the panel. Defaults to backtick.
  toggleKey?: string;
  // Shell prompt glyph. Defaults to the fish prompt.
  prompt?: string;
  // Lines shown the first time the console opens. Defaults to a short hint
  // plus the command list.
  banner?: string;
  // One-line blurb the built-in `describe` prints under the lens name.
  description?: string;
};

function defaultBanner(commands: ReadonlyArray<CommandDescriptor>): string {
  const hint = "console — backtick toggles · `help` lists commands · Esc closes";
  if (commands.length === 0) return hint;
  const names = commands.map((c) => c.name).join("  ");
  return `${hint}\n${names}`;
}

export function withConsole<
  S extends TickedState,
  C,
  I,
  P,
>(base: Lens<S, C, I, P>, options: WithConsoleOptions = {}): Lens<S, C, I, P> {
  return {
    ...base,
    // The decorated lens advertises one extra tunable — the console's open state
    // — so a host (or chrome) discovers it in the manifest and can toggle it.
    tunables: [...base.tunables, CONSOLE_OPEN_TUNABLE],
    mount(args: LensMountArgs<S, C, I, P>): MountedLens<S> {
      const mounted = base.mount(args);
      // The command registry flattens built-ins (transport, set/get, describe) +
      // the substrate's own commands into one live source (spec/26). Built from
      // the BASE lens, so `set` covers the substrate's tunables — `console_open`
      // is host-facing only (set via the toolbar, not typed), so it's not here.
      const source = buildConsoleRegistry({
        lens: base,
        mounted,
        host: args.host,
        ...(options.description !== undefined
          ? { meta: { description: options.description } }
          : {}),
      });
      // Listeners registered through our wrapped `subscribeTunables` — fired when
      // the console toggles (backtick / Esc / host) so the open-state stays synced.
      const consoleListeners = new Set<() => void>();
      const consoleWidget = mountConsole({
        classPrefix: options.classPrefix ?? `${base.id}-console`,
        mountTarget: args.container,
        source,
        ...(options.toggleKey !== undefined ? { toggleKey: options.toggleKey } : {}),
        ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
        banner: options.banner ?? defaultBanner(source.list()),
        onToggle: () => {
          for (const cb of consoleListeners) cb();
        },
      });
      const isConsolePath = (path: string[]): boolean =>
        path.length === 1 && path[0] === CONSOLE_OPEN_PATH;
      return {
        ...mounted,
        // Route the `console_open` tunable to the widget; forward the rest.
        getTunable: (path) =>
          isConsolePath(path) ? consoleWidget.isOpen() : mounted.getTunable(path),
        setTunable: (path, value) => {
          if (isConsolePath(path)) {
            if (value === true) consoleWidget.open();
            else if (value === false) consoleWidget.close();
            return;
          }
          mounted.setTunable(path, value);
        },
        // Notify on base tunable changes AND console toggles.
        subscribeTunables: (listener) => {
          const unsubBase = mounted.subscribeTunables(listener);
          consoleListeners.add(listener);
          return () => {
            unsubBase();
            consoleListeners.delete(listener);
          };
        },
        unmount() {
          consoleWidget.destroy();
          mounted.unmount();
        },
      };
    },
  };
}
